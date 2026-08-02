import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Employee schedule" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Week", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
});

test("moves, resizes, and creates controlled allocations", async ({ page }) => {
  await expect(page.getByRole("grid")).toHaveAttribute("aria-colcount", "5");
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("checkbox", { name: "Show weekends" }).check();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-colcount", "7");

  const firstEntry = page.locator('[data-entry-id="interaction-entry"]');
  const entryId = await firstEntry.getAttribute("data-entry-id");
  if (!entryId) throw new Error("A visible allocation is required.");
  const entry = page.locator(`[data-entry-id="${entryId}"]`);
  await expect(entry).toBeVisible();
  const beforeMove = await entry.getAttribute("aria-label");
  const entryBox = await entry.boundingBox();
  const dayBox = await page.locator(".fks-day-cell").first().boundingBox();
  if (!entryBox || !dayBox) throw new Error("Schedule geometry is unavailable.");

  await page.mouse.move(entryBox.x + entryBox.width / 2, entryBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    entryBox.x + entryBox.width / 2 + dayBox.width,
    entryBox.y + 8,
    { steps: 4 }
  );
  await page.mouse.up();
  await expect(entry).not.toHaveAttribute("aria-label", beforeMove ?? "");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const movedBox = await entry.boundingBox();
  const beforeResize = await entry.getAttribute("aria-label");
  if (!movedBox) throw new Error("Moved entry is unavailable.");
  await page.mouse.move(movedBox.x + movedBox.width - 2, movedBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(movedBox.x + movedBox.width + dayBox.width, movedBox.y + 8, {
    steps: 4
  });
  await page.mouse.up();
  await expect(entry).not.toHaveAttribute("aria-label", beforeResize ?? "");

  const created = page.locator('[data-entry-id^="created-"]');
  const targetRow = page.locator('[data-person-id="person-1"]');
  const targetBox = await targetRow.boundingBox();
  if (!targetBox) throw new Error("Creation row is unavailable.");
  await page.mouse.move(targetBox.x + 300, targetBox.y + targetBox.height - 5);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + 300 + dayBox.width * 2,
    targetBox.y + targetBox.height - 5,
    { steps: 4 }
  );
  await page.mouse.up();
  await expect(created).toHaveCount(1);
});

test("filters, zooms, shows hover content, and expands overflow inline", async ({
  page
}) => {
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Search people").fill("Ada Bakker");
  await page.getByRole("checkbox", { name: "Ada Bakker" }).check();
  await expect(page.locator(".fks-person-header")).toContainText("1 people");
  await page.getByRole("checkbox", { name: "Ada Bakker" }).uncheck();
  await page.getByRole("tab", { name: "Projects" }).click();
  await page.getByLabel("Search projects or companies").fill("northwind");
  await expect(page.getByRole("checkbox", { name: /Northwind/ })).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();

  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Week", exact: true })
  ).toHaveAttribute("aria-pressed", "true");

  const hoverTarget = page.locator(".fks-entry[data-entry-id]").first();
  await hoverTarget.hover();
  await expect(page.locator(".fks-hover-card")).toBeVisible();
  await page.locator(".fks-person-header").hover();
  await expect(page.locator(".fks-hover-card")).toBeHidden();

  const expander = page.getByRole("button", {
    name: "Expand allocations for Ada Bakker"
  });
  await expect(expander).toBeVisible();
  const rowHeight = await expander.evaluate(
    (element) => element.closest(".fks-row")?.getBoundingClientRect().height ?? 0
  );
  await expander.click();
  await expect(
    page.getByRole("button", { name: "Collapse allocations for Ada Bakker" })
  ).toBeVisible();
  const afterHeight = await page
    .getByRole("button", { name: "Collapse allocations for Ada Bakker" })
    .evaluate(
      (element) => element.closest(".fks-row")?.getBoundingClientRect().height ?? 0
    );
  expect(afterHeight).toBeGreaterThan(rowHeight);

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("tab", { name: "Capacity" }).click();
  await page.getByRole("checkbox", { name: "Over capacity" }).check();
  await page.getByRole("tab", { name: "Sort" }).click();
  await page
    .getByRole("radio", { name: "Capacity high to low" })
    .check();
});

test("opens allocations by click and exposes right-click actions", async ({ page }) => {
  const entry = page.locator('[data-entry-id="interaction-entry"]');
  await entry.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await entry.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit allocation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await entry.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete allocation" }).click();
  await expect(entry).toHaveCount(0);
});

test("keeps the narrow toolbar on one icon-first line", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const toolbar = page.locator(".fks-toolbar");
  await expect(toolbar).toBeVisible();
  const layout = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    flexWrap: getComputedStyle(element).flexWrap,
    height: element.getBoundingClientRect().height
  }));
  expect(layout.flexWrap).toBe("nowrap");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.height).toBeLessThanOrEqual(56);
  await expect(page.locator(".fks-filter-button__icon").first()).toBeVisible();
  await expect(page.locator(".fks-zoom-short").first()).toBeVisible();
});

test("keeps the 1,000-person fixture virtualized", async ({ page }) => {
  await page
    .getByRole("checkbox", { name: "1,000 people / 25k entries" })
    .check();
  await expect(page.locator(".fks-person-header")).toContainText("1000 people");
  expect(await page.locator(".fks-row").count()).toBeLessThan(35);

  await page.locator(".fks-scroll").evaluate((element) => {
    element.scrollTop = 30_000;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() => page.locator(".fks-scroll").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(20_000);
  expect(await page.locator(".fks-row").count()).toBeLessThan(35);
});

