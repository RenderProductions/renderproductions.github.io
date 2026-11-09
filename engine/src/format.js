// Small helpers for showing money and numbers the same way everywhere.

// 123456 cents -> "1,234.56"
function money(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return sign + whole + '.' + String(abs % 100).padStart(2, '0');
}

// "1,234.56 Polygons"
const poly = (cents) => money(cents) + ' Polygons';

function pct(n) {
  const v = Number(n) || 0;
  return (v >= 0 ? '▲ +' : '▼ ') + v.toFixed(2) + '%';
}

// "in 3h 12m"
function duration(ms) {
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

module.exports = { money, poly, pct, duration };
