// Apollo reports permissions as one bitmask in authenticated /serverinfo.
// Keep the names here aligned with Apollo's permission categories, so tools can
// give an invoker an actionable request instead of exposing a raw integer.
export const APOLLO_PERMISSIONS = [
  { key: "controller", label: "Controller Input", bit: 0x00000100, category: "input" },
  { key: "touch", label: "Touch Input", bit: 0x00000200, category: "input" },
  { key: "pen", label: "Pen Input", bit: 0x00000400, category: "input" },
  { key: "mouse", label: "Mouse Input", bit: 0x00000800, category: "input" },
  { key: "keyboard", label: "Keyboard Input", bit: 0x00001000, category: "input" },
  { key: "clipboard_write", label: "Clipboard Write", bit: 0x00010000, category: "operation" },
  { key: "clipboard_read", label: "Clipboard Read", bit: 0x00020000, category: "operation" },
  { key: "file_upload", label: "File Upload", bit: 0x00040000, category: "operation" },
  { key: "file_download", label: "File Download", bit: 0x00080000, category: "operation" },
  { key: "server_commands", label: "Server Commands", bit: 0x00100000, category: "operation" },
  { key: "list_apps", label: "List Apps", bit: 0x01000000, category: "session" },
  { key: "view_streams", label: "View Streams", bit: 0x02000000, category: "session" },
  { key: "launch_apps", label: "Launch Apps", bit: 0x04000000, category: "session" },
];

const BY_KEY = new Map(APOLLO_PERMISSIONS.map((permission) => [permission.key, permission]));

export const ACCESS_MODES = {
  read_only: {
    label: "read-only app discovery",
    required: ["list_apps"],
  },
  vision: {
    label: "view-only desktop session",
    required: ["list_apps", "view_streams", "launch_apps"],
  },
  computer_use: {
    label: "visual computer-use session",
    required: ["list_apps", "view_streams", "launch_apps", "mouse", "keyboard"],
  },
  input_only: {
    label: "input-only session",
    required: ["list_apps", "launch_apps", "mouse", "keyboard"],
  },
};

function include(keys) {
  return keys.map((key) => {
    const permission = BY_KEY.get(key);
    if (!permission) throw new Error(`Unknown Apollo permission '${key}'.`);
    return permission;
  });
}

function publicPermission(permission) {
  return {
    key: permission.key,
    label: permission.label,
    category: permission.category,
  };
}

export function decodePermissions(mask) {
  const numericMask = Number(mask) || 0;
  return {
    mask: numericMask,
    granted: APOLLO_PERMISSIONS.filter((permission) => (numericMask & permission.bit) === permission.bit)
      .map(publicPermission),
    notGranted: APOLLO_PERMISSIONS.filter((permission) => (numericMask & permission.bit) !== permission.bit)
      .map(publicPermission),
  };
}

export function preflightAccess(mask, mode, { apolloWebUrl, deviceName } = {}) {
  const access = ACCESS_MODES[mode];
  if (!access) throw new Error(`Unknown access mode '${mode}'.`);

  const numericMask = Number(mask) || 0;
  const required = include(access.required);
  const missing = required.filter((permission) => (numericMask & permission.bit) !== permission.bit);
  const ready = missing.length === 0;
  const missingLabels = missing.map((permission) => permission.label);

  return {
    mode,
    purpose: access.label,
    ready,
    requiredPermissions: required.map(publicPermission),
    missingPermissions: missing.map(publicPermission),
    userAction: ready ? null : {
      apolloWebUrl,
      message: `Open Apollo and grant ${missingLabels.join(", ")} to ${deviceName ?? "this MCP client"}, then call session_preflight again.`,
    },
  };
}
