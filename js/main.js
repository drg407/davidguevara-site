// The Living Test Suite — scroll-driven test runner

(function () {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const assertions = Array.from(document.querySelectorAll(".assertion"));
  const specHeaders = Array.from(document.querySelectorAll(".spec-header"));
  const counter = document.getElementById("test-counter");
  const suiteBadge = document.getElementById("suite-badge");
  const summaryPassed = document.getElementById("summary-passed");

  const total = assertions.length;
  let passed = 0;

  function updateCounter() {
    counter.textContent = passed + "/" + total + " passed";
    if (passed === total) {
      counter.classList.add("all-pass");
      suiteBadge.textContent = "PASS";
      suiteBadge.classList.remove("badge-run");
      suiteBadge.classList.add("badge-pass");
    }
  }

  function passAssertion(el) {
    if (el.classList.contains("passed")) return;
    el.classList.add("passed");
    passed++;
    updateCounter();
  }

  function passHeader(header) {
    const badge = header.querySelector(".spec-badge");
    if (!badge || badge.classList.contains("badge-pass")) return;
    badge.textContent = "PASS";
    badge.classList.remove("badge-run");
    badge.classList.add("badge-pass");
  }

  // Summary always reflects the full suite — the run is never in doubt,
  // only the reader's scroll position is.
  summaryPassed.textContent = total + " passed";

  if (reducedMotion || !("IntersectionObserver" in window)) {
    assertions.forEach((el) => el.classList.add("passed"));
    specHeaders.forEach(passHeader);
    passed = total;
    updateCounter();
    return;
  }

  updateCounter();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.classList.contains("spec-header")) {
          passHeader(el);
        } else {
          passAssertion(el);
        }
        observer.unobserve(el);
      });
    },
    { threshold: 0.4, rootMargin: "0px 0px -8% 0px" }
  );

  assertions.forEach((el) => observer.observe(el));
  specHeaders.forEach((el) => observer.observe(el));
})();
