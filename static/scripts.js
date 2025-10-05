// ---------------------------------------------
// scripts.js  (full replacement)
// ---------------------------------------------

const BODY_EL = typeof document !== "undefined" ? document.body : null;
const BANK_ENV = BODY_EL
  ? {
      id: BODY_EL.dataset.bankId || "",
      imageBase: BODY_EL.dataset.imageBase || "",
      questionsBase: BODY_EL.dataset.questionsBase || "",
      searchUrl: BODY_EL.dataset.searchUrl || "",
      notesUrl: BODY_EL.dataset.notesUrl || "",
    }
  : {};

// Simple note submitter (updated)
function submitNote() {
  const note = document.getElementById("note").value;
  const responseMessage = document.getElementById("responseMessage");

  const endpoint = BANK_ENV.notesUrl || "/submit_note";

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `note=${encodeURIComponent(note)}`,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "success") {
        responseMessage.style.color = "green";
        responseMessage.textContent = data.message;
        document.getElementById("note").value = "";
      } else {
        responseMessage.style.color = "red";
        responseMessage.textContent = data.message;
      }
    })
    .catch(() => {
      responseMessage.style.color = "red";
      responseMessage.textContent = "An error occurred. Please try again.";
    });
}

// --- Running points total ---
function computeSelectedPoints() {
  let pts = 0,
    count = 0;
  document.querySelectorAll(".question-checkbox:checked").forEach((el) => {
    const p = Number(el.dataset.points || 0);
    pts += isNaN(p) ? 0 : p;
    count += 1;
  });
  return { pts, count };
}

function updateSelectedPoints() {
  const { pts, count } = computeSelectedPoints();
  const ptsEl = document.getElementById("selectedPoints");
  const cntEl = document.getElementById("selectedGroups");
  if (ptsEl) ptsEl.textContent = `Selected: ${pts} pts`;
  if (cntEl)
    cntEl.textContent = `— ${count} ${count === 1 ? "group" : "groups"}`;
  if (typeof window.updateManualGenerate === "function") {
    window.updateManualGenerate();
  }
}

// Initialize display on load
document.addEventListener("DOMContentLoaded", () => {
  updateSelectedPoints();
  if (typeof window.updateManualGenerate === "function") {
    window.updateManualGenerate();
  }
});

// Update whenever a group checkbox changes (event delegation)
document.addEventListener("change", (e) => {
  if (
    e.target &&
    e.target.classList &&
    e.target.classList.contains("question-checkbox")
  ) {
    updateSelectedPoints();
  }
});

// --- Question-group image preview (gallery) ---
(function () {
  // Environment detection
  const supportsHover =
    window.matchMedia && window.matchMedia("(hover: hover)").matches;
  const pointerCoarse =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const galleryState = (window.__galleryState = window.__galleryState || {
    openCount: 0,
  });

  // Path resolver for gallery images
  const isAbs = (p) =>
    /^https?:\/\//i.test(p) || p.startsWith("/") || p.startsWith("data:");

  const imageBase = (BANK_ENV.imageBase || "").replace(/\/+$/, "");

  function resolveImg(p) {
    if (!p) return "";
    if (isAbs(p)) return p; // absolute (http(s), /, data:)

    let rel = p.replace(/^\/+/, "");

    if (imageBase) {
      if (rel.startsWith("images/")) {
        rel = rel.slice("images/".length);
      } else if (BANK_ENV.id && rel.startsWith(`${BANK_ENV.id}/`)) {
        rel = rel.slice(BANK_ENV.id.length + 1);
      }
      return `${imageBase}/${rel}`;
    }

    if (rel.startsWith("static/")) {
      return `/${rel}`;
    }

    return `/${rel}`;
  }

  function buildGrid(container, paths) {
    container.textContent = ""; // clear
    const frag = document.createDocumentFragment();

    if (!paths || !paths.length) {
      const empty = document.createElement("div");
      empty.textContent = "No images found for this group.";
      empty.style.padding = ".6rem";
      empty.style.color = "#666";
      container.appendChild(empty);
      return;
    }

    paths.forEach((p, i) => {
      const thumb = document.createElement("div");
      thumb.className = "gallery-thumb";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = `Question image ${i + 1}`;
      img.src = resolveImg(p);

      const cap = document.createElement("span");
      cap.textContent = p.split("/").slice(-1)[0];

      thumb.appendChild(img);
      thumb.appendChild(cap);
      frag.appendChild(thumb);
    });

    container.appendChild(frag);
  }

  function positionPopover(trigger, pop) {
    const pr = pop.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const M = 12;

    const top = Math.max(M, (vpH - pr.height) / 2);
    const left = Math.max(M, (vpW - pr.width) / 2);

    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }

  // function positionPopover(trigger, pop) {
  //   const pr = pop.getBoundingClientRect();
  //   const vpW = window.innerWidth;

  //   // Position below the trigger, horizontally clamped within viewport
  //   pop.style.top = `${trigger.offsetTop + trigger.offsetHeight + 6}px`;

  //   let left = trigger.offsetLeft + trigger.offsetWidth - pr.width;
  //   if (left < 8) left = 8;
  //   const rightEdge = left + pr.width;
  //   const maxRight = vpW - 8;
  //   if (rightEdge > maxRight) left = Math.max(8, maxRight - pr.width);

  //   pop.style.left = `${left}px`;
  // }

  // Close when clicking outside
  function addOutsideClickCloser(trigger, pop, close) {
    function onDocDown(e) {
      const t = e.target;
      if (!pop.contains(t) && t !== trigger) {
        close();
      }
    }
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("touchstart", onDocDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("touchstart", onDocDown, true);
    };
  }

  // Expose a hook to wire a single trigger/popover pair
  window.wireGalleryTrigger = function (trigger) {
    if (!trigger) return;

    const pop = trigger.nextElementSibling; // expected .gallery-popover
    if (!pop) return;

    const grid = pop.querySelector(".gallery-grid");
    const btnClose = pop.querySelector(".gallery-close");
    const imgs = JSON.parse(trigger.dataset.images || "[]");
    let built = false;
    let hoverTimer;
    let removeOutsideCloser = null;
    let lastFocus = null;

    const isOpen = () => pop.classList.contains("open");

    function open() {
      if (!built) {
        buildGrid(grid, imgs);
        built = true;
      }
      if (pop.parentElement !== document.body) {
        document.body.appendChild(pop);
      }
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const popWidth = Math.min(
        Math.max(viewportWidth * 0.86, 640),
        Math.max(640, viewportWidth - 24)
      );
      pop.style.width = `${Math.round(popWidth)}px`;
      const popMaxHeight = Math.min(Math.max(viewportHeight * 0.9, 480), viewportHeight - 24);
      pop.style.maxHeight = `${Math.round(popMaxHeight)}px`;

      pop.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      pop.setAttribute("aria-hidden", "false");
      positionPopover(trigger, pop);
      galleryState.openCount += 1;
      document.body.classList.add("gallery-open");

      // focus handling for accessibility
      lastFocus = document.activeElement;
      const focusTarget = btnClose || pop;
      if (!pop.hasAttribute("tabindex")) pop.setAttribute("tabindex", "-1");
      focusTarget.focus({ preventScroll: true });

      // outside click closer
      if (!removeOutsideCloser)
        removeOutsideCloser = addOutsideClickCloser(trigger, pop, close);
    }

    function close() {
      if (!pop.classList.contains("open")) return;
      pop.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      pop.setAttribute("aria-hidden", "true");
      if (removeOutsideCloser) {
        removeOutsideCloser();
        removeOutsideCloser = null;
      }
      if (galleryState.openCount > 0) {
        galleryState.openCount -= 1;
      }
      if (galleryState.openCount === 0) {
        document.body.classList.remove("gallery-open");
      }
      if (lastFocus && lastFocus instanceof HTMLElement) {
        lastFocus.focus({ preventScroll: true });
      } else {
        trigger.focus({ preventScroll: true });
      }
    }

    pop.addEventListener('gallery-force-close', () => {
      close();
    });

    // --- OPEN/CLOSE VIA CLICK (primary for touchpads/touch) ---
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (isOpen()) close();
      else open();
    });

    // --- KEYBOARD SUPPORT ---
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isOpen()) close();
        else open();
      }
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    // --- HOVER SUPPORT (kept for desktop/mouse; disabled on coarse pointers) ---
    if (supportsHover && !pointerCoarse) {
      trigger.addEventListener("mouseenter", () => {
        clearTimeout(hoverTimer);
        open();
      });
      trigger.addEventListener("mouseleave", () => {
        hoverTimer = setTimeout(() => {
          if (!pop.matches(":hover")) close();
        }, 180);
      });
      pop.addEventListener("mouseleave", () => {
        hoverTimer = setTimeout(() => {
          if (!trigger.matches(":hover")) close();
        }, 180);
      });
      pop.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
    }

    // Reposition on resize/scroll
    window.addEventListener("resize", () => {
      if (isOpen()) positionPopover(trigger, pop);
    });
    window.addEventListener(
      "scroll",
      () => {
        if (isOpen()) positionPopover(trigger, pop);
      },
      true
    );
  };
})();
