// api/check-env.js
module.exports = async (req, res) => {
  const envs = {
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    APP_URL: !!process.env.APP_URL,
    UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    NVIDIA_API_KEY: !!process.env.NVIDIA_API_KEY // Primary source
  };

  const missing = Object.keys(envs).filter(k => !envs[k]);

  res.status(200).json({
    ok: missing.length === 0,
    missing,
    envs
  });
};
