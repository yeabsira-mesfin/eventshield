import {test,expect} from '@playwright/test';

test('advanced registration setup: paths, questions, sessions, imports and previews',async({page},testInfo)=>{
 await page.goto('/');
 await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD);
 await page.getByRole('button',{name:/Sign in securely/}).click();
 await page.getByRole('button',{name:/Event setup/}).click();
 await expect(page.getByRole('heading',{name:'Registration configuration'})).toBeVisible();
 const newPath='QA Speaker '+Date.now();
 await page.getByLabel('New registration type').fill(newPath);
 await page.getByRole('button',{name:'Create registration path'}).click();
 await expect(page.getByText('Path added')).toBeVisible();
 await page.locator('select').nth(1).selectOption({label:newPath});
 await page.getByLabel('Allowed email domain, blank means unrestricted').fill('eventshield.test');
 await page.getByRole('button',{name:'Save eligibility rule'}).click();
 await expect(page.getByText('Domain restriction saved')).toBeVisible();
 await page.getByLabel('Question label').fill('Synthetic QA custom question');
 await page.locator('select').nth(2).selectOption({label:newPath});
 await page.getByLabel('Required answer').check();
 await page.getByRole('button',{name:'Add question'}).click();
 await expect(page.getByText('Question created')).toBeVisible();
 await page.getByLabel('Session name').fill('Synthetic QA workshop');
 await page.getByRole('button',{name:'Add session'}).click();
 await expect(page.getByText('Session created')).toBeVisible();
 await page.getByLabel('Admission name').fill('Synthetic QA admission');
 await page.getByRole('button',{name:'Add admission'}).click();
 await expect(page.getByText('Admission item created')).toBeVisible();
 await page.getByLabel('Audience email to suppress').fill('synthetic-suppressed-qa@example.test');
 await page.getByRole('button',{name:'Suppress'}).click();
 await expect(page.getByText('Suppression rule saved')).toBeVisible();
 await page.getByLabel('Choose attendee CSV').setInputFiles({
  name:'synthetic-attendees.csv',mimeType:'text/csv',
  buffer:Buffer.from('name,email\nSynthetic QA Import,synthetic-import-qa@example.test\nSynthetic QA Import 2,synthetic-import-qa@example.test\n')
 });
 await page.getByRole('button',{name:'Import attendee CSV'}).click();
 await expect(page.getByText('CSV import completed')).toBeVisible();
 await page.getByRole('button',{name:'Preview message'}).click();
 await expect(page.getByText('Preview refreshed')).toBeVisible();
 await expect(page.locator('.preview').getByText(/your registration for/)).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('eventshield-event-setup.png'),fullPage:true});
});
