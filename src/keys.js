const NAMED_KEYS = new Map([
  ["BACKSPACE", 8], ["TAB", 9], ["ENTER", 13], ["RETURN", 13], ["SHIFT", 16], ["CTRL", 17], ["CONTROL", 17],
  ["ALT", 18], ["PAUSE", 19], ["CAPSLOCK", 20], ["ESC", 27], ["ESCAPE", 27], ["SPACE", 32], ["PAGEUP", 33],
  ["PAGEDOWN", 34], ["END", 35], ["HOME", 36], ["LEFT", 37], ["UP", 38], ["RIGHT", 39], ["DOWN", 40],
  ["PRINTSCREEN", 44], ["INSERT", 45], ["DELETE", 46], ["META", 91], ["WIN", 91], ["WINDOWS", 91],
  ["CONTEXTMENU", 93], ["NUMLOCK", 144], ["SCROLLLOCK", 145],
]);

for (let code = 48; code <= 57; code++) NAMED_KEYS.set(String.fromCharCode(code), code);
for (let code = 65; code <= 90; code++) NAMED_KEYS.set(String.fromCharCode(code), code);
for (let number = 1; number <= 24; number++) NAMED_KEYS.set(`F${number}`, 111 + number);

export function resolveVirtualKey(key) {
  const normalized = String(key).trim().toUpperCase().replace(/[ _-]+/g, "");
  const code = NAMED_KEYS.get(normalized);
  if (code === undefined) throw new Error(`Unknown Windows key '${key}'. Use a letter, digit, F1-F24, or a standard key name such as ENTER, ESCAPE, TAB, SPACE, DELETE, LEFT, or WINDOWS.`);
  return { key: normalized, virtualKey: code };
}

export function resolveHotkey(key, modifiers = []) {
  const orderedModifiers = [];
  for (const modifier of modifiers) {
    const resolved = resolveVirtualKey(modifier);
    if (![16, 17, 18, 91].includes(resolved.virtualKey)) throw new Error(`'${modifier}' is not a shortcut modifier. Use SHIFT, CTRL, ALT, or WINDOWS.`);
    if (!orderedModifiers.includes(resolved.virtualKey)) orderedModifiers.push(resolved.virtualKey);
  }
  const resolvedKey = resolveVirtualKey(key);
  return { key: resolvedKey.key, virtualKeys: [...orderedModifiers, resolvedKey.virtualKey] };
}
