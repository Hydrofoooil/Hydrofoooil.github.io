"""Serve the browser's real art libraries and save its current rendered mask locally."""
import argparse
import base64
from html import escape
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import math
import mimetypes
import re
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
EDITOR = ROOT / 'tools' / 'splash-editor'
PHOTO = ROOT / 'assets' / 'portrait-v2.webp'
PHOTOS = {
    'original': {'filename': 'mmexport1774798073197.png', 'label': '原图（无后缀）', 'asset': 'assets/portrait-v2.webp'},
    'alternate': {'filename': 'mmexport1774798073197 (1).png', 'label': '备选图（(1) 后缀）', 'asset': 'assets/portrait-alternate.webp'},
    'photo222': {'filename': '222.png', 'label': '222.png', 'asset': 'assets/portrait-222.webp'},
}
for photo_id, entry in PHOTOS.items():
    with Image.open(ROOT / entry['asset']) as image:
        entry.update(width=image.width, height=image.height, id=photo_id, url=f'/photos/{photo_id}.webp')
WIDTH, HEIGHT = PHOTOS['original']['width'], PHOTOS['original']['height']
ENGINES = {'ink', 'p5', 'watercolor', 'washes', 'hokusai', 'easy', 'rough', 'freehand', 'fabric', 'aquarelle'}
SAVE_LOCK = Lock()
PRESETS = EDITOR / '.local' / 'presets'
LAYOUT_SCHEMA = json.loads((EDITOR / 'layout-schema.json').read_text())


def link_url(value, relative=False):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r'[\x00-\x20\x7f\\]', value):
        raise ValueError('链接地址不能包含空格或控制字符')
    if not value:
        return ''
    if relative and re.match(r'^(?:\./)?assets/', value) and '..' not in value.split('/') and ':' not in value:
        return value.removeprefix('./')
    url = urlparse(value)
    if url.scheme in ('http', 'https') and url.hostname:
        return value
    raise ValueError('请输入完整的 http(s) 网址或 assets/ 下的文件路径')


def validate_links(links=None):
    defaults = LAYOUT_SCHEMA['default']['links']
    if links is not None and not isinstance(links, dict):
        raise ValueError('链接参数无效')
    value = defaults | (links or {})
    if value['style'] not in ('outline', 'underline', 'soft') or value['font'] not in {font['id'] for font in LAYOUT_SCHEMA['fonts']} or type(value['followName']) is not bool:
        raise ValueError('链接样式无效')
    if not isinstance(value['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value['color']):
        raise ValueError('链接颜色格式无效')
    for key, (minimum, maximum) in LAYOUT_SCHEMA['linkLimits'].items():
        number = value[key]
        if type(number) not in (int, float) or not math.isfinite(number) or not minimum <= number <= maximum:
            raise ValueError('链接排版参数超出范围')
    if not isinstance(value['destinations'], dict):
        raise ValueError('链接地址无效')
    destinations = {}
    for item in LAYOUT_SCHEMA['linkItems']:
        key = item['id']
        raw = value['destinations'].get(key, defaults['destinations'][key])
        if not isinstance(raw, str):
            raise ValueError('链接地址无效')
        text = raw.strip()
        if key == 'email':
            email = re.sub(r'^mailto:', '', text, flags=re.I)
            if email and (len(email) > 200 or not re.fullmatch(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', email)):
                raise ValueError('Email 地址无效')
            destinations[key] = email
        elif key == 'wechat' and text and not re.match(r'^https?://', text, flags=re.I):
            if len(text) > 80 or re.search(r'[\s<>"\\:\x00-\x1f\x7f]', text):
                raise ValueError('请输入微信号或完整网址')
            destinations[key] = text
        else:
            destinations[key] = link_url(text, key == 'cv')
    if not isinstance(value['wechatQr'], str):
        raise ValueError('微信二维码地址无效')
    result = {key: value[key] for key in ('style', 'font', 'size', 'gap', 'color', 'followName', 'offset', 'x', 'y')}
    result['color'] = value['color'].lower()
    return result | {'destinations': destinations, 'wechatQr': link_url(value['wechatQr'].strip(), True)}


def links_markup(links):
    items = []
    for item in LAYOUT_SCHEMA['linkItems']:
        key, label, icon = item['id'], item['label'], item['icon']
        content = f'<svg class="social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icon}</svg><span>{label}</span><span class="social-arrow" aria-hidden="true">↗</span>'
        destination = links['destinations'][key]
        web_link = bool(re.match(r'^https?://', destination, flags=re.I))
        if key == 'wechat' and ((destination and not web_link) or links['wechatQr']):
            contact = (f'<a href="{escape(links["wechatQr"])}" target="_blank" rel="noopener noreferrer"><img src="{escape(links["wechatQr"])}" alt="毛挺的微信二维码" loading="lazy"></a>' if links['wechatQr'] else '')
            if destination and not web_link:
                contact += f'<p>微信号 <strong>{escape(destination)}</strong></p>'
            if web_link:
                contact += f'<a href="{escape(destination)}" target="_blank" rel="noopener noreferrer">打开微信链接 ↗</a>'
            items.append(f'<button type="button" class="social-link" data-link="wechat" popovertarget="wechat-contact">{content}</button><div class="wechat-card" id="wechat-contact" popover="auto" aria-labelledby="wechat-heading"><div class="wechat-heading"><span id="wechat-heading">WeChat</span><button type="button" popovertarget="wechat-contact" popovertargetaction="hide" aria-label="关闭微信二维码">×</button></div>{contact}</div>')
        else:
            href = 'mailto:' + destination if key == 'email' and destination else destination
            attributes = f'href="{escape(href)}"' + (' target="_blank" rel="noopener noreferrer"' if key != 'email' else '') if href else 'role="link" aria-disabled="true" title="Profile coming soon!"'
            items.append(f'<a class="social-link" data-link="{key}" {attributes}>{content}</a>')
    first, second = '\n'.join(items[:2]), '\n'.join(items[2:])
    return f'<div class="social-row">{first}</div>\n<div class="social-row">{second}</div>'


def validate_layout(layout):
    if not isinstance(layout, dict):
        raise ValueError('文字排版参数无效')
    result = {}
    for layer in ('english', 'chinese'):
        value = layout.get(layer)
        if not isinstance(value, dict) or not isinstance(value.get('text'), str) or len(value['text']) > 80:
            raise ValueError('姓名文字最多 80 个字符')
        if value.get('font') not in {font['id'] for font in LAYOUT_SCHEMA['fonts']}:
            raise ValueError('未知文字字体')
        if not isinstance(value.get('color'), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value['color']):
            raise ValueError('文字颜色格式无效')
        for key, (minimum, maximum) in LAYOUT_SCHEMA['limits'].items():
            number = value.get(key)
            if type(number) not in (int, float) or not math.isfinite(number) or not minimum <= number <= maximum:
                raise ValueError('文字参数超出范围')
        result[layer] = {key: value[key] for key in ('text', 'font', 'size', 'weight', 'color', 'tracking', 'x', 'y')}
        result[layer]['color'] = value['color'].lower()
    result['links'] = validate_links(layout.get('links'))
    return result


def homepage_layout():
    try:
        return validate_layout(json.loads((ROOT / 'assets' / 'homepage-layout.json').read_text()))
    except (OSError, ValueError, TypeError):
        return validate_layout(LAYOUT_SCHEMA['default'])


def layout_styles(layout):
    css = (EDITOR / 'layout-base.css').read_text()
    fonts = {font['id']: font['css'] for font in LAYOUT_SCHEMA['fonts']}
    for layer, selector in (('english', '.name-en'), ('chinese', '.name-zh')):
        value = layout[layer]
        css += f"\n{selector} {{\n  left: {value['x']}%;\n  top: {value['y']}%;\n  font-family: {fonts[value['font']]};\n  font-size: {value['size']}px;\n  font-weight: {value['weight']};\n  color: {value['color']};\n  letter-spacing: {value['tracking']}px;\n}}\n"
    links = layout['links']
    left = f"{layout['chinese']['x']}%" if links['followName'] else f"{links['x']}%"
    top = f"calc({layout['chinese']['y']}% + {layout['chinese']['size'] * 1.5 + links['offset']}px)" if links['followName'] else f"{links['y']}%"
    css += f"\n.social-links {{\n  left: {left};\n  top: {top};\n  --link-left: {left};\n  --link-gap: {links['gap']}px;\n  font-family: {fonts[links['font']]};\n  font-size: {links['size']}px;\n  color: {links['color']};\n}}\n"
    return css


def preset_path(preset_id):
    if not isinstance(preset_id, str) or not re.fullmatch(r'[0-9a-f]{32}', preset_id):
        raise ValueError('方案编号无效')
    return PRESETS / (preset_id + '.json')


def preset_summary(record):
    return {key: record[key] for key in ('id', 'name', 'updatedAt')} | {
        'engine': record['settings']['engine'], 'photoId': record['settings']['photoId']}


def validate_settings(settings):
    if not isinstance(settings, dict) or settings.get('version') != 3 or settings.get('engine') not in ENGINES:
        raise ValueError('效果参数无效')
    settings = dict(settings)
    settings.setdefault('photoId', 'original')
    if settings['photoId'] not in PHOTOS:
        raise ValueError('照片不存在')
    if 'layout' in settings:
        settings['layout'] = validate_layout(settings['layout'])
    points = settings.get('points')
    if not isinstance(points, list) or not 3 <= len(points) <= 80:
        raise ValueError('需要 3 至 80 个轮廓节点')
    for point in points:
        if not isinstance(point, list) or len(point) != 2 or any(type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1 for n in point):
            raise ValueError('轮廓坐标无效')
    if len(json.dumps(settings, allow_nan=False)) > 100000:
        raise ValueError('参数过大')
    return settings


def homepage_with_photo(entry, bounds, layout=None):
    """Keep viewport placement aligned with this photo's visible masked bounds."""
    html_path, css_path = ROOT / 'index.html', ROOT / 'styles.css'
    html = html_path.read_text()
    pattern = r'<img\b[^>]*\bclass="[^"]*\bsplash-photo\b[^"]*"[^>]*>'
    match = re.search(pattern, html)
    if not match:
        raise ValueError('找不到主页照片元素')
    tag = match.group()
    for key, value in {'src': entry['asset'], 'width': entry['width'], 'height': entry['height']}.items():
        attribute = f'{key}="{value}"'
        if re.search(rf'\b{key}="[^"]*"', tag):
            tag = re.sub(rf'\b{key}="[^"]*"', attribute, tag)
        else:
            tag = tag[:-1] + ' ' + attribute + '>'
    html = html[:match.start()] + tag + html[match.end():]
    css = css_path.read_text()
    css = re.sub(r'(\.splash-photo\s*\{[^}]*?aspect-ratio:\s*)[^;]+(;)',
                 lambda m: m[1] + f"{entry['width']} / {entry['height']}" + m[2], css, count=1, flags=re.S)
    left, top, right, bottom = bounds
    dimensions = {
        'photo-width': entry['width'], 'photo-height': entry['height'],
        'crop-width': right - left, 'crop-height': bottom - top,
        'crop-center-x': (left + right) / 2, 'crop-right': right,
        'crop-bottom-padding': entry['height'] - bottom,
    }
    def update_dimensions(match):
        block = match.group()
        for key, value in dimensions.items():
            pattern = rf'(--{key}:\s*)[^;]+;'
            if re.search(pattern, block):
                block = re.sub(pattern, lambda m: m[1] + str(value) + ';', block)
            else:
                block = block.replace('{', '{\n  --' + key + ': ' + str(value) + ';', 1)
        return block
    css = re.sub(r'\.splash-photo\s*\{[^}]*\}', update_dimensions, css, count=1)
    outputs = {html_path: html, css_path: css}
    if layout is not None:
        for layer, name in (('english', 'name-en'), ('chinese', 'name-zh')):
            pattern = rf'(<span\b[^>]*\bclass="{name}"[^>]*>).*?(</span>)'
            html, count = re.subn(pattern, lambda match: match[1] + escape(layout[layer]['text']) + match[2], html, count=1, flags=re.S)
            if not count:
                raise ValueError('找不到主页姓名元素')
        title = escape(layout['english']['text'] + ' · ' + layout['chinese']['text'])
        html = re.sub(r'<title>.*?</title>', lambda match: '<title>' + title + '</title>', html, count=1, flags=re.S)
        social = f'<nav class="social-links" aria-label="个人链接" data-style="{layout["links"]["style"]}">\n{links_markup(layout["links"])}\n</nav>'
        html, count = re.subn(r'(<!-- personal-links:start -->).*?(<!-- personal-links:end -->)', lambda match: match[1] + '\n' + social + '\n' + match[2], html, count=1, flags=re.S)
        if not count:
            raise ValueError('找不到主页个人链接元素')
        outputs[html_path] = html
        outputs[ROOT / 'assets' / 'homepage-layout.css'] = layout_styles(layout)
        outputs[ROOT / 'assets' / 'homepage-layout.json'] = json.dumps(layout, ensure_ascii=False, indent=2) + '\n'
    return outputs


class Handler(BaseHTTPRequestHandler):
    def reply(self, data, mime='application/json', status=200):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def error(self, error, status=400):
        self.reply(json.dumps({'error': str(error)}, ensure_ascii=False).encode(), status=status)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/homepage':
            self.send_response(302)
            self.send_header('Location', '/homepage/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if path.startswith('/homepage/'):
            relative = path.removeprefix('/homepage').lstrip('/') or 'index.html'
            file = (ROOT / relative).resolve()
            allowed = relative in ('index.html', 'styles.css', 'ZJUSRA_LOGO.jpg') or (
                relative.startswith('assets/') and file.is_relative_to((ROOT / 'assets').resolve()))
            if allowed and file.is_file():
                data = file.read_bytes()
                if relative == 'index.html' and parse_qs(urlparse(self.path).query).get('preview') == ['1']:
                    data = data.replace(b'</body>', b'<script type="module" src="/dist/layout-preview.js"></script></body>')
                self.reply(data, mimetypes.guess_type(file)[0] or 'application/octet-stream')
            else:
                self.error('页面不存在', 404)
            return
        if path == '/api/presets' or path.startswith('/api/presets/'):
            try:
                with SAVE_LOCK:
                    if path == '/api/presets':
                        records = [preset_summary(json.loads(file.read_text())) for file in PRESETS.glob('*.json')]
                        data = {'presets': sorted(records, key=lambda record: record['updatedAt'], reverse=True)}
                    else:
                        data = json.loads(preset_path(path.rsplit('/', 1)[1]).read_text())
                self.reply(json.dumps(data, ensure_ascii=False).encode())
            except FileNotFoundError:
                self.error('方案不存在', 404)
            except (ValueError, KeyError, TypeError) as exc:
                self.error(exc)
            except OSError as exc:
                self.error(exc, 500)
            return
        if path == '/api/config':
            saved = None
            try:
                saved = validate_settings(json.loads((ROOT / 'assets' / 'splash-settings.json').read_text()))
            except (OSError, ValueError, TypeError):
                pass
            self.reply(json.dumps({'width': WIDTH, 'height': HEIGHT, 'photos': list(PHOTOS.values()), 'saved': saved, 'homepageLayout': homepage_layout()}, ensure_ascii=False).encode())
            return
        if path == '/photo.webp':
            self.reply(PHOTO.read_bytes(), 'image/webp')
            return
        if path.startswith('/photos/'):
            entry = next((entry for entry in PHOTOS.values() if entry['url'] == path), None)
            if entry:
                self.reply((ROOT / entry['asset']).read_bytes(), 'image/webp')
            else:
                self.error('照片不存在', 404)
            return
        if path in ('/', '/editor.css') or path.startswith(('/dist/', '/vendor/')):
            file = (EDITOR / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
            if file.is_relative_to(EDITOR.resolve()) and file.is_file():
                mime = {'.js': 'text/javascript', '.wasm': 'application/wasm', '.myb': 'application/json'}.get(file.suffix, mimetypes.guess_type(file)[0] or 'application/octet-stream')
                self.reply(file.read_bytes(), mime)
                return
        self.error('页面不存在', 404)

    def do_POST(self):
        if self.path not in ('/api/apply', '/api/presets'):
            self.error('页面不存在', 404)
            return
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            self.error('只允许调节器页面保存', 403)
            return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.error('需要 JSON 参数', 415)
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 40000000:
                raise ValueError('请求大小无效')
            body = json.loads(self.rfile.read(size))
            if self.path == '/api/presets':
                self.save_preset(body)
                return
            settings = validate_settings(body['settings'])
            settings['layout'] = validate_layout(settings.get('layout', homepage_layout()))
            entry = PHOTOS[settings['photoId']]
            width, height = entry['width'], entry['height']
            url = body['mask']
            prefix = 'data:image/png;base64,'
            if not isinstance(url, str) or not url.startswith(prefix):
                raise ValueError('需要 PNG 蒙版')
            png = base64.b64decode(url[len(prefix):], validate=True)
            with Image.open(BytesIO(png)) as mask:
                if mask.format != 'PNG' or mask.size != (width, height) or mask.mode != 'RGBA':
                    raise ValueError('蒙版尺寸或格式不正确')
                mask.load()
                with Image.open(ROOT / entry['asset']) as photo:
                    photo_alpha = photo.getchannel('A')
                    bounds = ImageChops.multiply(photo_alpha, mask.getchannel('A')).getbbox() or photo_alpha.getbbox()
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" xlink:href="{url}"/></svg>\n'
            with SAVE_LOCK:
                outputs = homepage_with_photo(entry, bounds, settings['layout'])
                outputs[ROOT / 'assets' / 'contour-splash-mask.svg'] = svg
                outputs[ROOT / 'assets' / 'splash-settings.json'] = json.dumps(settings, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
                for target, data in outputs.items():
                    tmp = target.with_suffix(target.suffix + '.tmp')
                    tmp.write_text(data)
                    tmp.replace(target)
            self.reply(json.dumps({'ok': True, 'message': f"已应用 {entry['label']}、当前墨迹和文字排版到本地主页，尚未发布到 GitHub Pages"}, ensure_ascii=False).encode())
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self.error(exc)
        except Exception as exc:
            self.error(exc, 500)

    def save_preset(self, body):
        name = body.get('name')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError('方案名称需为 1 至 80 个字符')
        settings = validate_settings(body['settings'])
        quality = settings.get('quality')
        if type(quality) is not int or quality not in (700, 1000, 1400):
            raise ValueError('效果分辨率无效')
        entry = PHOTOS[settings['photoId']]
        url = body['mask']
        prefix = 'data:image/png;base64,'
        if not isinstance(url, str) or not url.startswith(prefix):
            raise ValueError('需要 PNG 蒙版')
        png = base64.b64decode(url[len(prefix):], validate=True)
        with Image.open(BytesIO(png)) as image:
            expected = (quality, round(quality * entry['height'] / entry['width']))
            if image.format != 'PNG' or image.mode != 'RGBA' or image.size != expected:
                raise ValueError('方案蒙版尺寸或格式不正确')
            image.load()
        preset_id = body.get('id') or uuid4().hex
        target = preset_path(preset_id)
        record = {'id': preset_id, 'name': name.strip(), 'settings': settings, 'mask': url,
                  'updatedAt': datetime.now(timezone.utc).isoformat()}
        data = json.dumps(record, ensure_ascii=False, allow_nan=False)
        with SAVE_LOCK:
            if body.get('id') and not target.is_file():
                raise ValueError('要覆盖的方案不存在')
            PRESETS.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix('.tmp')
            tmp.write_text(data)
            tmp.replace(target)
        self.reply(json.dumps({'preset': preset_summary(record)}, ensure_ascii=False).encode())

    def do_DELETE(self):
        if not self.path.startswith('/api/presets/'):
            self.error('页面不存在', 404)
            return
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            self.error('只允许调节器页面保存', 403)
            return
        try:
            with SAVE_LOCK:
                preset_path(self.path.rsplit('/', 1)[1]).unlink()
            self.reply(b'{"ok":true}')
        except FileNotFoundError:
            self.error('方案不存在', 404)
        except ValueError as exc:
            self.error(exc)
        except OSError as exc:
            self.error(exc, 500)

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1]) not in ('200', '304'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    print(f'墨迹工作台：http://127.0.0.1:{args.port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
