// Share the hero QR popover with inline biography links.
for (const link of document.querySelectorAll('[data-wechat-contact]')) {
  link.addEventListener('click', event => {
    const card = document.getElementById('wechat-contact');
    if (!card?.showPopover) return;
    event.preventDefault();
    card.showPopover();
  });
}
