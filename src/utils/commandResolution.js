export function getCommandTemplate(config, platform, category) {
  if (!config || !platform || !category) return null;
  const platformConfig = config?.[platform];
  const templates = platformConfig?.commandTemplates;
  if (!templates) return null;
  const tpl = templates?.[category];
  if (!tpl || typeof tpl !== 'object') return null;
  return {
    pattern: typeof tpl.pattern === 'string' ? tpl.pattern : '',
    description: typeof tpl.description === 'string' ? tpl.description : '',
  };
}

export function resolveCommand(rawCommand, category, config, platform) {
  const raw = String(rawCommand || '').trim();
  if (!raw || !category) return raw;

  const template = getCommandTemplate(config, platform, category);
  const pattern = String(template?.pattern || '').trim();

  if (!pattern || pattern === '{cmd}') return raw;
  if (!pattern.includes('{cmd}')) return pattern;

  // Keep behavior consistent with backend: if user already typed an explicit interpreter or shell ops,
  // do not wrap it with a template.
  const startsWithInterpreter = /^(bash|sh|zsh|python|python3|node|powershell|pwsh|cmd|open)\b/i.test(raw);
  if (startsWithInterpreter) return raw;

  const hasShellOps = /&&|\|\||[;&|<>`]/.test(raw);
  if (hasShellOps) return raw;

  return pattern.replace(/\{cmd\}/g, raw);
}

