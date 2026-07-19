const copyButton = document.querySelector("[data-copy]");
const menuButton = document.querySelector(".menu-toggle");
const primaryNavigation = document.querySelector("#primary-navigation");

copyButton?.addEventListener("click", async () => {
  const target = document.querySelector(copyButton.dataset.copy);
  if (!target) return;

  try {
    await navigator.clipboard.writeText(target.innerText);
    showCopiedState();
  } catch {
    const field = document.createElement("textarea");
    field.value = target.innerText;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (copied) showCopiedState();
    else copyButton.textContent = "Select and copy";
  }
});

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  primaryNavigation?.classList.toggle("is-open", open);
});

primaryNavigation?.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLAnchorElement)) return;
  menuButton?.setAttribute("aria-expanded", "false");
  primaryNavigation.classList.remove("is-open");
});

function showCopiedState() {
  const original = copyButton.innerHTML;
  copyButton.textContent = "Copied";
  copyButton.disabled = true;
  window.setTimeout(() => {
    copyButton.innerHTML = original;
    copyButton.disabled = false;
  }, 1800);
}
