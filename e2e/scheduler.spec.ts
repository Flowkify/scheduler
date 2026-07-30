import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Employee schedule" })).toBeVisible();
});

test("moves, resizes, and creates controlled allocations", async ({ page }) => {
  const entry = page.locator('[data-entry-id="entry-67"]');
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

test("filters, zooms, shows hover content, and opens overflow without reflow", async ({
  page
}) => {
  await page.getByLabel("Search people").fill("Ada Bakker");
  await expect(page.locator(".fks-person-header")).toContainText("1 people");
  await page.getByLabel("Search people").press("Control+A");
  await page.getByLabel("Search people").press("Backspace");

  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Week", exact: true })
  ).toHaveAttribute("aria-pressed", "true");

  const hoverTarget = page.locator(".fks-entry[data-entry-id]").first();
  await hoverTarget.hover();
  await expect(page.locator(".fks-hover-card")).toBeVisible();

  await page.keyboard.press("Escape");
  const overflow = page.locator(".fks-overflow-button").first();
  if ((await overflow.count()) > 0) {
    const rowHeight = await overflow
      .locator("xpath=ancestor::*[contains(@class,'fks-row')]")
      .evaluate((element) => element.getBoundingClientRect().height);
    await overflow.click();
    await expect(page.locator(".fks-overflow-panel")).toBeVisible();
    const afterHeight = await overflow
      .locator("xpath=ancestor::*[contains(@class,'fks-row')]")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(afterHeight).toBe(rowHeight);
  }
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

