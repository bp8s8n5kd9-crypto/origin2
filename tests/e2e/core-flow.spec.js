const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
});

test('creates a region and a usable child scene', async ({ page }) => {
  await page.getByLabel('新增地区').click();
  await page.getByPlaceholder('输入新地区名称').fill('南京');
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('南京 / 家')).toBeVisible();

  await page.getByRole('button', { name: '场景管理' }).click();
  await page.getByRole('button', { name: /在“家”下新建/ }).click();
  await page.getByLabel('场景名称').fill('厨房');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#sceneTree')).toContainText('厨房');
});

test('opens record search and shows existing records', async ({ page }) => {
  await page.getByRole('button', { name: '时间记录' }).click();
  await page.getByRole('button', { name: '查找流水' }).click();
  await expect(page.getByRole('heading', { name: '查找与整理投入记录' })).toBeVisible();
  await expect(page.locator('#recordBrowserCount')).not.toHaveText('0 条记录');
});

test('renders synced text as text instead of markup', async ({ page }) => {
  await page.getByRole('button', { name: '场景管理' }).click();
  await page.getByRole('button', { name: '添加行动' }).click();
  const actionInput=page.locator('#actionEditor .action-card input');
  const actionCount=await actionInput.count();
  await actionInput.nth(actionCount-1).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.getByRole('button', { name: '当前场景' }).click();
  await expect(page.locator('#optionList img')).toHaveCount(0);
  await expect(page.locator('#optionList')).toContainText('<img src=x onerror=alert(1)>');
});
