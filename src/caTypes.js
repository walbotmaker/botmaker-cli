const CaType = Object.freeze({
  USER: 'USER',
  ENDPOINT: 'ENDPOINT',
  AI_FUNCTION: 'AI_FUNCTION',
  WHATSAPP_FLOW: 'WHATSAPP_FLOW',
  WEBCHAT_FORM: 'WEBCHAT_FORM',
  SCHEDULE: 'SCHEDULE',
});

const getTypeFolder = (type) => {
  if (type === CaType.ENDPOINT) return 'endpoint';
  if (type === CaType.AI_FUNCTION) return 'mcp';
  if (type === CaType.USER) return 'user';
  if (type === CaType.WHATSAPP_FLOW) return 'whatsappflow';
  if (type === CaType.WEBCHAT_FORM) return 'webchatforms';
  if (type === CaType.SCHEDULE) return 'schedule';
  return null;
};

const TYPE_FOLDERS = ['user', 'endpoint', 'mcp', 'whatsappflow', 'webchatforms', 'schedule'];

const buildLocalRelPath = (type, basename) => {
  const typeFolder = getTypeFolder(type);
  return typeFolder ? `src/${typeFolder}/${basename}` : basename;
};

const extractBasename = (filename) => {
  if (!filename) return '';
  const parts = filename.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
};

module.exports = Object.assign({}, CaType, {
  getTypeFolder,
  buildLocalRelPath,
  extractBasename,
  TYPE_FOLDERS,
});
