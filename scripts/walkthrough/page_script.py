SCRIPT = """
const KEY = "parfocal-walkthrough-done";
const memory = {};
const store = {
  read() {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) || "{}");
    } catch {
      return memory;
    }
  },
  write(value) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      Object.assign(memory, value);
    }
  },
};

const done = store.read();
const steps = [...document.querySelectorAll("article.step")];
const progress = document.getElementById("progress");

function showProgress() {
  const visible = steps.filter((item) => !item.classList.contains("hidden"));
  const ticked = visible.filter((item) => done[item.dataset.step]).length;
  progress.textContent = `${ticked} of ${visible.length} done`;
}

for (const item of steps) {
  const box = item.querySelector("input[type=checkbox]");
  box.checked = Boolean(done[item.dataset.step]);
  item.classList.toggle("done", box.checked);
  box.addEventListener("change", () => {
    if (box.checked) done[item.dataset.step] = true;
    else delete done[item.dataset.step];
    item.classList.toggle("done", box.checked);
    store.write(done);
    showProgress();
  });
}

function filterRole(role) {
  for (const button of document.querySelectorAll("[data-role]")) {
    button.setAttribute("aria-pressed", String(button.dataset.role === role));
  }
  for (const item of steps) {
    item.classList.toggle("hidden", role !== "all" && item.dataset.who !== role);
  }
  for (const chapter of document.querySelectorAll("section.chapter")) {
    const shown = chapter.querySelectorAll("article.step:not(.hidden)").length;
    chapter.classList.toggle("hidden", shown === 0);
    const pill = document.querySelector(`a.step[href="#${chapter.id}"]`);
    if (pill) pill.classList.toggle("hidden", shown === 0);
  }
  showProgress();
}

document.querySelector(".roles").addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (button) filterRole(button.dataset.role);
});

const pills = [...document.querySelectorAll("a.step")];
const watcher = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const pill of pills) {
        pill.setAttribute(
          "aria-current",
          String(pill.getAttribute("href") === `#${entry.target.id}`),
        );
      }
    }
  },
  { rootMargin: "-160px 0px -70% 0px" },
);
for (const chapter of document.querySelectorAll("section.chapter")) {
  watcher.observe(chapter);
}

filterRole("all");
"""
