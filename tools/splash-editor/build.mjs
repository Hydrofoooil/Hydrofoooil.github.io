import { build } from 'esbuild';
import { mkdir,copyFile,readdir,readFile,writeFile,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
const result=await build({entryPoints:['editor.js','layout-preview.js'],bundle:true,format:'esm',splitting:true,outdir:'dist',chunkNames:'engine-[name]-[hash]',minify:false,sourcemap:true,legalComments:'eof',metafile:true});
const packages=new Set(['three-legacy']);
for(const path of Object.keys(result.metafile.inputs)){
 const match=path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
 if(match)packages.add(match[1]);
}
await mkdir('vendor/licenses',{recursive:true});
const manifest=[];
for(const name of [...packages].sort()){
 const root=`node_modules/${name}`,p=JSON.parse(await readFile(`${root}/package.json`));
 const license=(await readdir(root)).find(f=>/^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(f));
 if(license)await copyFile(`${root}/${license}`,`vendor/licenses/${name.replaceAll('/','-')}.txt`);
 manifest.push({name,version:p.version,source:`https://www.npmjs.com/package/${p.name}/v/${p.version}`,repository:p.repository||null,license:p.license||'Not declared by upstream package',licenseFile:license||null});
}
await writeFile('vendor/npm-sources.json',JSON.stringify(manifest,null,2)+'\n');
const files=[];
async function hashes(root){for(const entry of await readdir(root,{withFileTypes:true})){const path=`${root}/${entry.name}`;if(entry.isDirectory())await hashes(path);else if(!['sources.json','npm-sources.json','README.md'].includes(entry.name))files.push({path:path.slice('vendor/'.length),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}}
await hashes('vendor');
await writeFile('vendor/sources.json',JSON.stringify({upstreams:{washes:'https://github.com/castavridis/washes-js/tree/14e485b6e83dba1b5d02c987ae2ddd2222c60063',hokusai:'https://github.com/reearth/hokusai/tree/f7e998173c0e7427b95afe0b6947e3103da60f00',aquarelle:'https://github.com/Ramotion/aquarelle/tree/aef4c7cd9fc4ab482559f49447822a1df169216d',hokusaiDemo:'https://reearth.github.io/hokusai/'},files},null,2)+'\n');
