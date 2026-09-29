const blockedKeys = /password|secret|certificate|private.?key|pfx|p12|xml|payload/i;
export function sanitizeMetadata(value:Record<string,unknown>) { return Object.fromEntries(Object.entries(value).filter(([key]) => !blockedKeys.test(key))); }
export function logEvent(level:"info"|"warn"|"error", event:string, metadata:Record<string,unknown>={}) { const entry={ timestamp:new Date().toISOString(), level, event, ...sanitizeMetadata(metadata) }; (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(JSON.stringify(entry)); }
