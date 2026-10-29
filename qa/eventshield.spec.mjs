import {test,expect} from '@playwright/test';

test('desktop/mobile UI, registration and forbidden cross-user request',async({page,request},testInfo)=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD);
  await page.getByRole('button',{name:/Sign in securely/}).click();
  await expect(page.getByText('Welcome, Admin.')).toBeVisible();
  await expect(page.getByText('Security posture')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('eventshield-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Events/}).first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('eventshield-mobile.png'),fullPage:true});
  const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:/Events/}).first().click();
  await expect(page.getByRole('heading',{name:'Event management'})).toBeVisible();
  const title='QA Event '+Date.now();
  await page.getByPlaceholder('Annual security summit').fill(title);
  await page.locator('input[type=datetime-local]').fill('2027-05-12T16:00');
  await page.getByRole('button',{name:'Create draft event'}).click();
  await expect(page.getByText('Event draft created')).toBeVisible();
  const row=page.locator('tr').filter({hasText:title});
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:'Publish'}).click();
  await expect(row.getByText('published')).toBeVisible();
  const attacker=await request.post('http://127.0.0.1:3000/api/auth/login',{data:{email:'guest@eventshield.test',password:process.env.DEMO_PASSWORD}});
  const owner=await request.post('http://127.0.0.1:3000/api/auth/login',{data:{email:'attendee@eventshield.test',password:process.env.DEMO_PASSWORD}});
  expect(attacker.ok()).toBeTruthy();
  expect(owner.ok()).toBeTruthy();
  const attackerToken=(await attacker.json()).token,ownerToken=(await owner.json()).token;
  const list=await request.get('http://127.0.0.1:3000/api/events',{headers:{Authorization:'Bearer '+attackerToken}});
  const event=(await list.json()).events.find(e=>e.title===title);
  const newRegistration=await request.post('http://127.0.0.1:3000/api/events/'+event.id+'/registrations',{
    headers:{Authorization:'Bearer '+ownerToken},data:{attendee_name:'Synthetic QA Attendee'}
  });
  expect(newRegistration.status()).toBe(201);
  const id=(await newRegistration.json()).registration.id;
  const denial=await request.get('http://127.0.0.1:3000/api/registrations/'+id,{headers:{Authorization:'Bearer '+attackerToken}});
  expect(denial.status()).toBe(403);
  await page.getByRole('button',{name:/Security Center/}).first().click();
  await expect(page.getByRole('heading',{name:'Security Center'})).toBeVisible();
  await page.getByRole('button',{name:/Refresh/}).click();
  await expect(page.getByText('object access denied').first()).toBeVisible();
});
