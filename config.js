window.APP_CONFIG = {
  apiBase: ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? ''
    : 'https://xeoqnlkuuqbhjplmwbts.supabase.co/functions/v1/company-api'
};