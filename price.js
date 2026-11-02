// Extrait les prix probables et le nom du produit des mots lus par l'OCR.
// Mots en entrée : [{ text, x0, y0, x1, y1, confidence }].
(function (root) {
  const MIN_CENTS = 5;
  const MAX_CENTS = 50000;
  const UNIT_RE = /\/|kg|^(m|c)?[lL]$|^g$/i;
  const NAME_STOPWORDS = new Set([
    'prix', 'kilo', 'litre', 'euro', 'euros', 'eur', 'soit', 'promo', 'origine', 'france', 'lot', 'les', 'des', 'unite',
  ]);

  function toCents(euros, decimals) {
    const cents = parseInt(euros, 10) * 100 + parseInt(decimals, 10);
    return cents >= MIN_CENTS && cents <= MAX_CENTS ? cents : null;
  }

  function sameLine(a, b) {
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return overlap > 0.3 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
  }

  // Confusions classiques de l'OCR dans un nombre : O pour 0, l ou I pour 1.
  function cleanNumber(text) {
    const trimmed = text.trim();
    if (/^[lI|]$/.test(trimmed)) return '1';
    if (!/\d/.test(trimmed)) return trimmed;
    return trimmed
      .replace(/^[lI|](?=[\d,.€])/, '1')
      .replace(/[oO](?=[\d,.€]|$)/g, '0')
      .replace(/€\/(\d)$/, '€7$1'); // « 3€/5 » : un 7 lu comme une barre, pas une unité.
  }

  // Un prix suivi de « /kg », « /L »… est un prix de référence, pas le prix à payer.
  function followedByUnit(words, i, tail) {
    if (UNIT_RE.test(tail)) return true;
    const next = words[i + 1];
    return Boolean(next && sameLine(words[i], next) && UNIT_RE.test(next.text.trim()));
  }

  function parsePrices(words) {
    const found = [];
    const add = (cents, height, unit, confidence, unsure = false) => {
      if (cents === null) return;
      found.push({ cents, unit, unsure, score: height * confidence * (unit ? 0.4 : 1) });
    };

    words.forEach((word, i) => {
      const text = cleanNumber(word.text);
      const height = word.y1 - word.y0;

      // 2,49 — 2.49 — 2€49 — 2,49€
      const full = text.match(/^\D*(\d{1,3})[,.€](\d{2})(?!\d)(.*)$/);
      if (full) {
        const tail = full[3].replace(/^€/, '');
        add(toCents(full[1], full[2]), height, followedByUnit(words, i, tail), 1);
        return;
      }

      // « 2 » en gros et « 49 » en petit, lus comme deux mots.
      const euros = text.match(/^(\d{1,3})[,.€]?$/);
      const next = words[i + 1];
      const nextText = next ? cleanNumber(next.text) : '';
      if (euros && next && /^\d{2}€?$/.test(nextText) && sameLine(word, next)
          && next.x0 >= word.x1 && next.x0 - word.x1 < height) {
        add(toCents(euros[1], nextText.slice(0, 2)), height, followedByUnit(words, i + 1, ''), 1);
        return;
      }

      // 3€
      const whole = text.match(/^(\d{1,3})€(.*)$/);
      if (whole) {
        add(toCents(whole[1], '00'), height, followedByUnit(words, i, whole[2]), 0.9);
        return;
      }

      // 249 : séparateur non lu. Probable seulement si rien de mieux n'est trouvé.
      const glued = text.match(/^(\d{1,2})(\d{2})$/);
      if (glued) {
        add(toCents(glued[1], glued[2]), height, followedByUnit(words, i, ''), 0.25, true);
        return;
      }

      // 2,5 — une seule décimale.
      const short = text.match(/^(\d{1,3})[,.](\d)$/);
      if (short) {
        add(toCents(short[1], short[2] + '0'), height, followedByUnit(words, i, ''), 0.5, true);
        return;
      }

      // 12 — nombre seul : peut être un prix rond, ou des centimes écrits en petit non lus.
      const bare = text.match(/^(\d{1,3})$/);
      if (bare) add(toCents(bare[1], '00'), height, followedByUnit(words, i, ''), 0.3, true);
    });

    const best = new Map();
    for (const price of found.sort((a, b) => b.score - a.score)) {
      if (!best.has(price.cents)) best.set(price.cents, price);
    }
    return [...best.values()];
  }

  // Combine plusieurs lectures de la même image : un prix relu plusieurs fois remonte.
  function mergeReadings(readings) {
    const merged = new Map();
    for (const prices of readings) {
      for (const price of prices) {
        const known = merged.get(price.cents);
        if (known) {
          known.score += price.score;
          known.unit = known.unit && price.unit;
          known.unsure = known.unsure && price.unsure;
          known.reads += 1;
        } else {
          merged.set(price.cents, { ...price, reads: 1 });
        }
      }
    }
    return [...merged.values()].sort((a, b) => b.score - a.score);
  }

  // Présélectionner un prix douteux fausserait le total sans que l'on s'en aperçoive.
  function isConfident(prices) {
    const [top, ...others] = prices;
    if (!top || top.unit || top.unsure) return false;
    return !others.some((other) => !other.unit && !other.unsure && other.score >= top.score / 2);
  }

  // Le nom est la ligne de vrais mots écrite le plus gros. Il reste modifiable dans l'appli.
  function extractName(words) {
    const usable = words.filter((word) => {
      const text = word.text.trim();
      const letters = text.replace(/[^\p{L}]/gu, '');
      return letters.length >= 3 && letters.length === text.length
        && (word.confidence === undefined || word.confidence >= 60)
        && !NAME_STOPWORDS.has(text.toLowerCase());
    });

    const lines = [];
    for (const word of usable) {
      const line = lines.find((other) => sameLine(other[0], word));
      if (line) line.push(word);
      else lines.push([word]);
    }
    if (!lines.length) return '';

    const weight = (line) => line.reduce((sum, word) => sum + word.text.length * (word.y1 - word.y0), 0);
    const best = lines.sort((a, b) => weight(b) - weight(a))[0];
    return best
      .sort((a, b) => a.x0 - b.x0)
      .slice(0, 4)
      .map((word) => word.text.trim())
      .join(' ')
      .toLowerCase()
      .replace(/^\p{L}/u, (letter) => letter.toUpperCase());
  }

  root.parsePrices = parsePrices;
  root.extractName = extractName;
  root.mergeReadings = mergeReadings;
  root.isConfident = isConfident;
})(typeof self !== 'undefined' ? self : this);
