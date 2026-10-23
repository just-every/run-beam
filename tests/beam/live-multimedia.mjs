// Manual real-provider qualification. No network stubs, copied sessions or keys.
// Public examples published for embedding: Google's iframe API sample,
// Loom's employee-led demo, and FORCE11's CC BY-SA embedding example.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'

if (!process.argv.includes('--live')) throw new Error('Run explicitly with --live for actual provider playback')
const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
await mkdir(evidence, { recursive: true })
const f = await fixture({ businessName: 'Sierra Lakes Produce', names: { learner: 'Riley Morgan', author: 'Jordan Lee', reviewer: 'Sam Taylor' } })
let browser
try {
  await f.api('owner','embed.policy',{version:0,hosts:'www.youtube.com\nwww.loom.com\ndocs.google.com'})
  const course = await f.api('author','course.create',{title:'Using the learning library',reviewer:f.ids.reviewer})
  let draft = await f.api('author','course.lesson',{course:course.id,draftVersion:course.draftVersion,title:'Watch and explore',body:'Watch the public provider examples, then explore the slides.',sources:[]})
  const lesson=draft.draft.lessons[0].id
  const examples=[
    ['YouTube player example','https://www.youtube.com/watch?v=M7lc1UVf-VE'],
    ['Loom product demo','https://www.loom.com/share/3d029f2547b24ada97b2101f60a258b9'],
    ['Data citation slides','https://docs.google.com/presentation/d/12iLxkVFEthMzUYfEHtBaOPU9ADu8al7KEJZbYBNVN2k/embed?start=false&loop=false&delayms=3000'],
  ]
  for (const [text,url] of examples) draft=await f.api('author','course.block',{course:course.id,draftVersion:draft.draftVersion,lesson,content:{kind:'embed',text,url}})
  const revision=(await f.api('author','course.submit',{course:course.id,draftVersion:draft.draftVersion})).id
  await f.publish(revision)
  const assignment=await f.assign(course), learning=await f.view(assignment)
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic','--ignore-certificate-errors']})
  const failures=[]
  for (const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
    try {
      await context.addCookies(f.cookies.learner.split('; ').map(cookie=>{const at=cookie.indexOf('=');return {name:cookie.slice(0,at),value:cookie.slice(at+1),url:f.h.origin}}))
      const page=await context.newPage()
      await page.goto(`${f.h.origin}/app/learn/${assignment}/lessons/${learning.lessons[0].id}`)
      for (const [title] of examples) {
        const iframe=page.locator(`iframe[title="${title}"]`), frame=page.frameLocator(`iframe[title="${title}"]`)
        await iframe.scrollIntoViewIfNeeded()
        try {
          if (title.includes('slides')) {
            await frame.locator('body').waitFor({state:'attached'})
            const body=frame.locator('body'), before=await body.innerText()
            const image=await iframe.screenshot()
            await iframe.focus()
            await page.keyboard.press('ArrowRight')
            await body.evaluate((node,before)=>new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>{clearInterval(check);reject(new Error('Public slide position did not change'))},15000),check=setInterval(()=>{if(node.innerText!==before){clearTimeout(timer);clearInterval(check);resolve()}},50)
            }),before)
            assert.notDeepEqual(await iframe.screenshot(),image,'learner navigation changes the rendered public slide')
            console.log('LIVE SLIDES',width,before,'to',await body.innerText())
          } else {
            const video=frame.locator('video:visible').first()
            await video.waitFor({state:'attached',timeout:30000})
            const initial=await video.evaluate(media=>{media.muted=true;return {src:media.currentSrc,playing:!media.paused}})
            console.log('LIVE CONTROLS',title,width,await frame.locator('video,button,[role="button"]').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,label:node.getAttribute('aria-label'),title:node.getAttribute('title'),text:node.textContent?.slice(0,60),visible:!!(node.offsetWidth&&node.offsetHeight),...(node instanceof HTMLVideoElement?{time:node.currentTime,duration:node.duration,paused:node.paused}:{} )})).filter(node=>node.visible)))
            const controls=await frame.getByRole('button',{name:/^play\b/i}).all()
            let play
            for (const control of controls) if (await control.isVisible()) {play=control;break}
            assert.ok(play,'the real provider exposes an accessible Play control')
            await play.click()
            // Providers replace the thumbnail video node when real playback starts.
            // Observe the current content element, never a detached preview node.
            const playing=await frame.locator('body').evaluate((body,initial)=>new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>{clearInterval(check);reject(new Error('Actual provider playback did not advance'))},15000),check=setInterval(()=>{
                const media=[...body.querySelectorAll('video')].filter(media=>media.offsetWidth&&media.offsetHeight&&!media.paused&&media.readyState>=2&&(!initial.playing||media.currentSrc!==initial.src)).sort((a,b)=>b.duration-a.duration)[0]
                if(media?.currentTime>0.2){const result={time:media.currentTime,duration:media.duration,readyState:media.readyState};media.pause();clearTimeout(timer);clearInterval(check);resolve(result)}
              },50)
            }),initial)
            console.log('LIVE PLAYBACK',title,width,playing)
          }
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
          await page.screenshot({path:join(evidence,`${width}-live-${title.split(' ')[0].toLowerCase()}.png`)})
          console.log('PASS live provider learner',title,width)
        } catch(error) {
          failures.push(`${title} ${width}: ${error.message}`)
          console.log('LIVE REFUSAL',title,width,error.message)
          console.log('PROVIDER MEDIA STATE',await frame.locator('body').evaluate(body=>({videos:[...body.querySelectorAll('video')].map(media=>({time:media.currentTime,duration:media.duration,paused:media.paused,readyState:media.readyState,networkState:media.networkState,error:media.error&&{code:media.error.code,message:media.error.message},width:media.offsetWidth,height:media.offsetHeight})),player:typeof document.getElementById('movie_player')?.getPlayerState==='function'?document.getElementById('movie_player').getPlayerState():null})).catch(()=>null))
          console.log('PROVIDER PAGE',await frame.locator('body').innerText().then(text=>text.slice(0,3000)).catch(()=>'(no provider document)'))
          await page.screenshot({path:join(evidence,`${width}-live-${title.split(' ')[0].toLowerCase()}-refused.png`)})
        }
      }
    } finally { await context.close() }
  }
  assert.deepEqual(failures,[],'real provider playback qualification')
} finally {
  await browser?.close()
  await f.h.close()
}
