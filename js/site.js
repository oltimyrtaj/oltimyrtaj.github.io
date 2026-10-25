/* Shared behavior for every page:
   1. Image slots: when a picture listed in the HTML is not uploaded yet, its
      frame shows which file to add (the headshot shows a monogram instead).
   2. Lightbox: select a gallery image to view it full screen.
   3. Email links are assembled here so the address is not in the HTML.
   4. The CV download button checks that files/Myrtaj_CV.pdf exists.
   This file loads in <head> so it catches images that fail early. */
(function () {
  "use strict";

  function addNote(fig, path) {
    if (fig.querySelector(".slot-note")) return;
    var frame = fig.querySelector(".frame") || fig;
    var note = document.createElement("div");
    note.className = "slot-note";
    var title = document.createElement("span");
    title.className = "slot-title";
    title.textContent = fig.querySelector("video") ? "Movie to add" : "Image to add";
    var code = document.createElement("code");
    code.textContent = path;
    note.appendChild(title);
    note.appendChild(code);
    if (fig.dataset.slot) {
      var hint = document.createElement("span");
      hint.className = "slot-hint";
      hint.textContent = fig.dataset.slot;
      note.appendChild(hint);
    }
    frame.appendChild(note);
  }

  function markMissing(media) {
    var fig = media.closest(".slot");
    if (!fig || fig.classList.contains("is-missing")) return;
    fig.classList.add("is-missing");
    var path = media.getAttribute("src");
    if (!path) {
      var source = media.querySelector("source");
      path = source ? source.getAttribute("src") : "";
    }
    addNote(fig, path || "");
    var zoom = fig.querySelector(".zoom");
    if (zoom) {
      zoom.disabled = true;
      zoom.setAttribute("aria-hidden", "true");
      zoom.tabIndex = -1;
    }
  }

  // Errors on <img> and <source> do not bubble, so listen in the capture phase.
  document.addEventListener("error", function (event) {
    var el = event.target;
    if (!el || !el.tagName) return;
    if (el.tagName === "IMG") markMissing(el);
    else if (el.tagName === "SOURCE" && el.parentElement) {
      // A movie can list several formats. It counts as missing only when the last one fails too.
      var sources = el.parentElement.querySelectorAll("source");
      if (el === sources[sources.length - 1]) markMissing(el.parentElement);
    }
  }, true);

  // A movie that loads after all clears any missing mark it was given.
  document.addEventListener("loadedmetadata", function (event) {
    var fig = event.target && event.target.closest && event.target.closest(".slot.is-missing");
    if (!fig) return;
    fig.classList.remove("is-missing");
    var note = fig.querySelector(".slot-note");
    if (note) note.remove();
  }, true);

  // Movies count as missing only through the error listener above. Phone browsers hold a movie
  // unloaded until it is tapped, and its loading state then looks the same as a missing file.
  function sweepMissing() {
    document.querySelectorAll(".slot img").forEach(function (img) {
      if (img.complete && img.naturalWidth === 0) markMissing(img);
    });
  }

  /* ---------- Lightbox ---------- */

  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  function setupLightbox() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll(".zoom"));
    if (!buttons.length || typeof HTMLDialogElement === "undefined") return;

    var dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Image viewer");
    dialog.innerHTML =
      '<div class="lightbox-inner">' +
      '<img alt="">' +
      '<p class="lightbox-caption"></p>' +
      "</div>" +
      '<button type="button" class="lb-btn lb-close" aria-label="Close">' + ICON.close + "</button>" +
      '<button type="button" class="lb-btn lb-prev" aria-label="Previous image">' + ICON.prev + "</button>" +
      '<button type="button" class="lb-btn lb-next" aria-label="Next image">' + ICON.next + "</button>";
    document.body.appendChild(dialog);

    var img = dialog.querySelector("img");
    var caption = dialog.querySelector(".lightbox-caption");
    var list = [];
    var index = 0;
    var opener = null;

    function available() {
      return buttons.filter(function (b) {
        var fig = b.closest(".slot");
        return fig && !fig.classList.contains("is-missing");
      });
    }

    function show(i) {
      if (!list.length) return;
      index = (i + list.length) % list.length;
      var button = list[index];
      var source = button.querySelector("img");
      var fig = button.closest(".slot");
      var cap = fig ? fig.querySelector("figcaption") : null;
      img.src = source.currentSrc || source.src;
      img.alt = source.alt;
      caption.innerHTML = cap ? cap.innerHTML : "";
      var many = list.length > 1;
      dialog.querySelector(".lb-prev").hidden = !many;
      dialog.querySelector(".lb-next").hidden = !many;
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        list = available();
        var i = list.indexOf(button);
        if (i < 0) return;
        opener = button;
        show(i);
        dialog.showModal();
      });
    });

    dialog.querySelector(".lb-close").addEventListener("click", function () { dialog.close(); });
    dialog.querySelector(".lb-prev").addEventListener("click", function () { show(index - 1); });
    dialog.querySelector(".lb-next").addEventListener("click", function () { show(index + 1); });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog || event.target.classList.contains("lightbox-inner")) dialog.close();
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { event.preventDefault(); show(index - 1); }
      if (event.key === "ArrowRight") { event.preventDefault(); show(index + 1); }
    });
    dialog.addEventListener("close", function () {
      img.removeAttribute("src");
      if (opener) opener.focus();
    });
  }

  /* ---------- Email ---------- */

  function setupEmail() {
    document.querySelectorAll("a[data-email-user]").forEach(function (a) {
      var address = a.dataset.emailUser + "@" + a.dataset.emailDomain;
      a.href = "mailto:" + address;
      if (!a.dataset.keepText) a.textContent = address;
    });
  }

  /* ---------- CV download check ---------- */

  function setupDownloadCheck() {
    // Until files/Myrtaj_CV.pdf is uploaded, the button stays hidden. It appears by itself once the file exists.
    document.querySelectorAll("a[data-check-file]").forEach(function (a) {
      if (!/^https?:$/.test(location.protocol)) return;
      a.style.display = "none";
      fetch(a.getAttribute("href"), { method: "HEAD", cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("missing");
          a.style.display = "";
        })
        .catch(function () {});
    });
  }

  function init() {
    sweepMissing();
    setupLightbox();
    setupEmail();
    setupDownloadCheck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addEventListener("load", sweepMissing);
})();
