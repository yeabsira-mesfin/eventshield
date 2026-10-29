import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('EventShield login and authenticated dashboard have no serious WCAG failures',async({page})=>{
 await page.goto('/');
 let findings=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(findings.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD);
 await page.getByRole('button',{name:/Sign in securely/}).click();
 await expect(page.getByRole('heading',{name:/Welcome, Admin/})).toBeVisible();
 findings=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(findings.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});