// On a post page, reveal the "Edit" link only in a browser where the blog editor
// (/blog/write/) has saved its GitHub token, i.e. the author's own. Visitors never see it,
// and the editor still needs that token to publish anything.
try {
  if (localStorage.getItem('blog-editor:token') || sessionStorage.getItem('blog-editor:token')) {
    for (const link of document.querySelectorAll('.post-edit')) link.hidden = false;
  }
} catch {
  // storage disabled: keep the link hidden
}
