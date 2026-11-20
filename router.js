// Picks the cheapest Claude model that can handle the job.
// Free to run: it's plain rules, not an extra AI call, so routing never eats your credit.
(function (root) {
'use strict';

const MODELS = {
  haiku:  { label: 'Haiku 5.5',  tier: 'Fast',     blurb: 'Quick chats, planning, short answers' },
  sonnet: { label: 'Sonnet 5.5', tier: 'Balanced', blurb: 'Writing, explaining, normal coding' },
  opus:   { label: 'Opus 5.5',   tier: 'Max',      blurb: 'Big builds, hard bugs, deep reasoning' },
};

const BIG = [
  /\b(build|create|make|write|implement|code|program|develop)\b.{0,40}\b(app|game|engine|system|website|site|server|backend|api|tool|plugin|mod|bot|ai|shader|compiler)\b/i,
  /\b(refactor|architect(ure)?|optimi[sz]e|debug|stack ?trace|segfault|memory leak|race condition|multiplayer|netcode)\b/i,
  /\b(prove|derive|step[- ]by[- ]step proof|rigorous|in[- ]depth analysis|deep dive|research report)\b/i,
  /\b(entire|whole|full|complete)\b.{0,25}\b(code|project|script|game|app|program|file)\b/i,
];
const MEDIUM = [
  /```/, /\b(function|class|def|const|let|var|import|#include|SELECT|unity|godot|unreal|three\.js|python|javascript|typescript|c\+\+|c#|lua|rust)\b/i,
  /\b(essay|article|story|chapter|script|lyrics?|cover letter|resume|report|email|explain|compare|summari[sz]e|translate|review)\b/i,
  /\b(why|how does|how do)\b/i,
];
const SIMPLE = [
  /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|lol|bye|gm|gn)\b/i,
  /\b(plan|planning|todo|to-do|list|idea|ideas|name for|brainstorm|schedule|checklist|quick question|what is|what's|who is|define|meaning of)\b/i,
];

function routeModel(text, history = []) {
  const t = String(text);
  const words = t.trim().split(/\s+/).length;
  const lines = t.split('\n').length;

  if (words > 600 || lines > 80) return { model: 'opus', reason: 'Long input' };
  if (BIG.some(r => r.test(t))) return { model: 'opus', reason: 'Big or hard task' };

  // Follow-ups stay on the stronger model if the chat was already doing heavy work
  const lastA = [...history].reverse().find(m => m.role === 'assistant');
  const followUp = words < 25 && /^(and|also|now|ok|okay|then|can you|could you|fix|change|add|make it|it|that|this)\b/i.test(t.trim());
  if (followUp && lastA && lastA.model && lastA.model !== 'haiku') return { model: lastA.model, reason: 'Follow-up to ' + lastA.model };

  if (SIMPLE.some(r => r.test(t)) && words < 80 && !/```/.test(t)) return { model: 'haiku', reason: 'Simple chat or planning' };
  if (MEDIUM.some(r => r.test(t)) || words > 150) return { model: 'sonnet', reason: 'Normal task' };
  if (words < 40) return { model: 'haiku', reason: 'Short message' };
  return { model: 'sonnet', reason: 'Normal task' };
}

const api = { routeModel, MODELS };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ForgeRouter = api;
})(this);
