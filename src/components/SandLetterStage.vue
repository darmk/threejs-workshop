<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { SandLetter, type SandLetterState } from '../three/SandLetter'

const host = ref<HTMLElement | null>(null)
const text = ref('下次见，\n就在海边。')
const state = ref<SandLetterState>({ phase: 'written', progress: 0 })
const error = ref('')
const inputError = ref('')
const presets = ['下次见，就在海边。', '毕业快乐，前程似海。', '谢谢你，来过我的夏天。']
let beach: SandLetter | undefined
function write() {
  if (!text.value.trim()) { inputError.value = '先写下一句话，再交给海浪。'; return }
  if (text.value.trim().split('\n').length > 2) { inputError.value = '最多写两行，让每一个字都能留在沙上。'; return }
  inputError.value = ''; beach?.setText(text.value)
}
function preset(value: string) { text.value = value; write() }
onMounted(() => {
  if (!host.value) return
  try { beach = new SandLetter(host.value, text.value, next => { state.value = next }) }
  catch { error.value = '当前浏览器无法启动 WebGL，请换一个支持 WebGL 的浏览器。' }
})
onBeforeUnmount(() => beach?.dispose())
</script>

<template>
  <section class="sand-workspace" aria-label="在沙滩写下一句话，等海浪把它带走">
    <div class="sand-stage" @pointermove="beach?.pointer($event.clientX, $event.clientY)" @pointerleave="beach?.leave()">
      <div ref="host" class="sand-canvas"></div>
      <div class="sand-top"><span>写给下一阵海浪 <i></i> 016</span><span>有些话，让海听见。</span></div>
      <div class="sand-note"><small>WORDS ON THE SHORE</small><strong>写在这里，<br />交给海。</strong></div>
      <div class="sand-caption"><i></i><span>{{ state.phase === 'written' ? '字已经写好了。等一阵海浪，或者再多看一会儿。' : state.phase === 'washing' ? state.progress < 50 ? '海浪正在靠近，字迹一点点藏进水里。' : '潮水退去，留下浅痕和湿润的沙。' : '海听见了。你也可以重新写下，再等下一阵浪。' }}</span></div>
      <div v-if="state.phase === 'washing'" class="sand-progress"><span>一来一回</span><b>{{ state.progress }}<small>%</small></b></div>
      <p v-if="error" class="sand-error" role="alert">{{ error }}</p>
    </div>
    <form class="sand-editor" @submit.prevent="write">
      <label class="sand-input"><span>想留在沙上的话 <small>最多 24 字 · 最多两行</small></span><textarea v-model="text" maxlength="24" rows="2" aria-label="写在沙滩上的话" placeholder="写下一句话…" :disabled="Boolean(error)"></textarea></label>
      <div class="sand-buttons"><button type="submit" :disabled="Boolean(error)">重新写下</button><button type="button" class="sand-wash" :disabled="Boolean(error) || state.phase === 'washing'" @click="beach?.wash()">{{ state.phase === 'washing' ? '让海浪慢慢来…' : '让海浪来' }} <span aria-hidden="true">↗</span></button></div>
      <p v-if="inputError" class="sand-input-error" role="alert">{{ inputError }}</p>
    </form>
    <div class="sand-presets"><span>也可以写：</span><button v-for="item in presets" :key="item" :disabled="Boolean(error)" @click="preset(item)">{{ item }}</button><small>文字只留在当前页面，不会上传</small></div>
  </section>
</template>

<style scoped>
.sand-workspace{border:1px solid #b0a48b;background:#eee6d6;color:#4b5246}.sand-stage{position:relative;height:clamp(540px,49vw,700px);overflow:hidden;background:#cbb18a}.sand-canvas,.sand-canvas :deep(canvas){position:absolute;inset:0;width:100%;height:100%;display:block}
.sand-top{position:absolute;top:27px;left:30px;right:30px;display:flex;justify-content:space-between;font-size:10px;color:#e4ece0;letter-spacing:.1em;pointer-events:none}.sand-top>span:first-child{display:flex;align-items:center;gap:14px}.sand-top i{width:28px;height:1px;background:#d8e5d599}
.sand-note{position:absolute;top:95px;left:39px;pointer-events:none}.sand-note small{font-size:9px;color:#4c756d;letter-spacing:.13em}.sand-note strong{display:block;margin-top:16px;color:#3b625b;font-family:'Songti SC',SimSun,serif;font-size:clamp(27px,3vw,40px);font-weight:400;line-height:1.5;letter-spacing:.04em}
.sand-caption{position:absolute;bottom:26px;left:30px;right:24px;display:flex;align-items:center;gap:12px;color:#625b49;font-size:10px;line-height:1.8;pointer-events:none}.sand-caption i{width:23px;height:1px;background:#78705b;flex-shrink:0}.sand-progress{position:absolute;top:96px;right:33px;display:grid;gap:10px;justify-items:end;color:#3b625b;pointer-events:none}.sand-progress>span{font-size:10px}.sand-progress b{font-size:30px;font-weight:400;font-variant-numeric:tabular-nums}.sand-progress small{font-size:12px;margin-left:3px}
.sand-editor{display:flex;align-items:end;gap:28px;padding:24px 28px;border-top:1px solid #b4ad95;background:#f3eee1;flex-wrap:wrap}.sand-input{display:block;flex:1;min-width:220px}.sand-input>span{display:flex;justify-content:space-between;margin-bottom:10px;font-size:11px;color:#5a6553}.sand-input small{font-size:9px;color:#8b8a75}.sand-input textarea{box-sizing:border-box;width:100%;display:block;resize:vertical;min-height:65px;max-height:140px;padding:10px 13px;background:#fbf8f0;border:1px solid #c3bba5;border-radius:0;color:#4b5548;font:14px/1.65 inherit;font-family:inherit;font-size:14px;line-height:1.65}.sand-buttons{display:flex;gap:18px;align-items:center;padding-bottom:8px}.sand-buttons button{min-height:43px;border:0;background:transparent;color:#5a6654;font-size:11px;white-space:nowrap;padding:8px 4px}.sand-buttons .sand-wash{min-width:150px;padding:9px 17px;background:#456f66;color:#f6f4e5}.sand-wash span{margin-left:25px;font-size:17px}.sand-presets{padding:13px 28px;display:flex;align-items:center;gap:17px;flex-wrap:wrap;border-top:1px solid #d2cab7;font-size:9px;color:#8b8875}.sand-presets button{border:0;border-bottom:1px solid #b6b69c;background:transparent;padding:4px 0;color:#6b765e;font-size:10px}.sand-presets small{margin-left:auto;font-size:9px}.sand-input-error{flex-basis:100%;margin:0;color:#965739;font-size:11px}button:not(:disabled){cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,textarea:focus-visible{outline:2px solid #456f66;outline-offset:4px}.sand-error{position:absolute;inset:0;margin:0;display:grid;place-items:center;padding:25px;background:#eee6d6ed;text-align:center;font-size:14px}
@media(max-width:600px){.sand-stage{height:580px}.sand-top{top:22px;left:20px;right:20px;font-size:8px}.sand-top i{display:none}.sand-note{left:24px;top:75px}.sand-note strong{font-size:29px;margin-top:12px}.sand-note small{font-size:8px}.sand-caption{left:22px;bottom:23px;font-size:9px}.sand-progress{top:77px;right:23px}.sand-progress b{font-size:25px}.sand-editor{padding:21px 18px;gap:17px}.sand-input{min-width:0;flex-basis:100%}.sand-buttons{width:100%;justify-content:space-between;padding-bottom:0}.sand-presets{padding:12px 18px;gap:8px 14px}.sand-presets>span,.sand-presets small{flex-basis:100%;margin:0}}
</style>
