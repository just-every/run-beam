import { createRuntimeModel } from './state.ts'
import type { PackageStandard } from './types.ts'

/** Installed inside the SCO, which deliberately has an opaque sandbox origin. */
export function runtimeScript(standard: PackageStandard, initial: Record<string, string>, bridgeId: string): string {
  const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  return `(() => {
    const standard = ${literal(standard)}, state = ${literal(initial)}, bridge = ${literal(bridgeId)};
    const model = (${createRuntimeModel.toString()})(standard), legacy = standard === '1.2';
    let initialized = false, terminated = false, error = '0', diagnostic = '';
    const messages = legacy ? {
      '0':'No error','101':'General exception','201':'Invalid argument','202':'Element cannot have children','203':'Element is not an array','301':'Not initialized','401':'Not implemented','402':'Invalid set value, element is a keyword','403':'Element is read only','404':'Element is write only','405':'Incorrect data type'
    } : {
      '0':'No error','101':'General exception','102':'General initialization failure','103':'Already initialized','104':'Content instance terminated','111':'General termination failure','112':'Termination before initialization','113':'Termination after termination','122':'Retrieve data before initialization','123':'Retrieve data after termination','132':'Store data before initialization','133':'Store data after termination','142':'Commit before initialization','143':'Commit after termination','201':'General argument error','301':'General get failure','351':'General set failure','391':'General commit failure','401':'Undefined data model element','402':'Unimplemented data model element','403':'Data model element value not initialized','404':'Data model element is read only','405':'Data model element is write only','406':'Data model element type mismatch','407':'Data model element value out of range','408':'Data model dependency not established'
    };
    function fail(code, detail, result = 'false') { error = String(code); diagnostic = detail || messages[error] || ''; return result; }
    function ok(result) { error = '0'; diagnostic = ''; return result; }
    function guard(kind) {
      if (!initialized) return fail(legacy ? 301 : ({get:122,set:132,commit:142,terminate:112})[kind]), false;
      if (terminated) return fail(legacy ? 301 : ({get:123,set:133,commit:143,terminate:113})[kind]), false;
      return true;
    }
    function initialize(argument) {
      if (argument !== '') return fail(201);
      if (terminated) return fail(legacy ? 101 : 104);
      if (initialized) return fail(legacy ? 101 : 103);
      initialized = true; return ok('true');
    }
    function get(key) {
      if (!guard('get')) return '';
      if (typeof key !== 'string') return fail(201, '', '');
      try { return ok(model.get(state, key)); } catch (e) { return fail(e.code || 301, e.message, ''); }
    }
    function set(key, value) {
      if (!guard('set')) return 'false';
      if (typeof key !== 'string' || value === undefined || value === null) return fail(201);
      try { model.set(state, key, String(value)); return ok('true'); } catch (e) { return fail(e.code || 351, e.message); }
    }
    function persist(kind, argument) {
      if (!guard(kind)) return 'false';
      if (argument !== '') return fail(201);
      try {
        model.validateScores(state);
        parent.postMessage({beamPackage:bridge,kind:kind === 'terminate' ? 'terminate' : 'commit',values:{...state}}, '*');
        if (kind === 'terminate') terminated = true;
        return ok('true');
      } catch (e) { return fail(e.code || (legacy ? 101 : 391), e.message); }
    }
    const functions = {Initialize:initialize, GetValue:get, SetValue:set, Commit:(argument) => persist('commit',argument), Terminate:(argument) => persist('terminate',argument), GetLastError:() => error, GetErrorString:(code) => messages[String(code)] || '', GetDiagnostic:(code) => code === '' || code === undefined || String(code) === error ? diagnostic || messages[error] || '' : messages[String(code)] || ''};
    if (legacy) window.API = {LMSInitialize:functions.Initialize,LMSGetValue:get,LMSSetValue:set,LMSCommit:functions.Commit,LMSFinish:functions.Terminate,LMSGetLastError:functions.GetLastError,LMSGetErrorString:functions.GetErrorString,LMSGetDiagnostic:functions.GetDiagnostic};
    else window.API_1484_11 = functions;
  })();`
}
