// ---------------------------------------------
// scripts.js  (full replacement)
// ---------------------------------------------

// Simple note submitter (unchanged behavior)
function submitNote() {
  const note = document.getElementById("note").value;
  const responseMessage = document.getElementById("responseMessage");

  fetch("/submit_note", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `note=${encodeURIComponent(note)}`,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "success") {
        responseMessage.style.color = "green";
        responseMessage.textContent = data.message;
        document.getElementById("note").value = ""; // Clear the textarea
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

// --- Question-group image preview (gallery) ---
(function () {
  // Path resolver for gallery images
  const isAbs = (p) =>
    /^https?:\/\//i.test(p) || p.startsWith("/") || p.startsWith("data:");

  function resolveImg(p) {
    if (!p) return "";
    if (isAbs(p)) return p; // absolute (http(s), /, data:)
    if (p.startsWith("images/")) return "/" + p; // served by Flask at /images/<path>
    return "/static/" + p.replace(/^\/+/, ""); // fallback for real static assets
  }

  function buildGrid(container, paths) {
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
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = `Question image ${i + 1}`;
      img.src = resolveImg(p);

      const cap = document.createElement("figcaption");
      cap.textContent = p.split("/").slice(-1)[0];

      fig.appendChild(img);
      fig.appendChild(cap);
      frag.appendChild(fig);
    });

    container.appendChild(frag);
  }

  function positionPopover(trigger, pop) {
    const pr = pop.getBoundingClientRect();
    const vpW = window.innerWidth;

    // Position below the trigger, horizontally clamped within viewport
    pop.style.top = `${trigger.offsetTop + trigger.offsetHeight + 6}px`;

    let left = trigger.offsetLeft + trigger.offsetWidth - pr.width;
    if (left < 8) left = 8;
    const rightEdge = left + pr.width;
    const maxRight = vpW - 8;
    if (rightEdge > maxRight) left = Math.max(8, maxRight - pr.width);

    pop.style.left = `${left}px`;
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

    function open() {
      if (!built) {
        buildGrid(grid, imgs);
        built = true;
      }
      pop.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      pop.setAttribute("aria-hidden", "false");
      positionPopover(trigger, pop);
    }

    function close() {
      pop.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      pop.setAttribute("aria-hidden", "true");
    }

    // Hover intent
    trigger.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimer);
      open();
    });
    trigger.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(close, 180);
    });

    // Keep open while hovering popover
    pop.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
    pop.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(close, 180);
    });

    // Close controls
    if (btnClose) btnClose.addEventListener("click", close);
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    // Reposition on resize/scroll
    window.addEventListener("resize", () => {
      if (pop.classList.contains("open")) positionPopover(trigger, pop);
    });
    window.addEventListener(
      "scroll",
      () => {
        if (pop.classList.contains("open")) positionPopover(trigger, pop);
      },
      true
    );
  };
})();
