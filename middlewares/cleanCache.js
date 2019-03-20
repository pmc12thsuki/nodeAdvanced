const { clearHash } = require('../services/cache');

module.exports = async (req, res, next) => {
  clearHash(req.user.id); // 清理 cache
};
