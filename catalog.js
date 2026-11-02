// Catégories, suggestion à partir du nom et recherche dans les articles déjà achetés.
(function (root) {
  const CATEGORIES = [
    { id: 'fruits', icon: '🍎', name: 'Fruits, légumes', keywords: 'pomme banane poire orange citron clementine mandarine fraise framboise raisin kiwi ananas melon abricot peche prune salade laitue tomate carotte courgette aubergine poivron oignon echalote ail concombre poireau chou brocoli epinard haricot champignon avocat fruit legume' },
    { id: 'viande', icon: '🥩', name: 'Viande, poisson', keywords: 'poulet dinde boeuf steak veau porc agneau canard jambon lardon saucisse saucisson chorizo merguez viande escalope roti cote filet saumon thon cabillaud colin truite sardine maquereau crevette poisson moule' },
    { id: 'frais', icon: '🧀', name: 'Frais', keywords: 'yaourt yogourt lait beurre creme fromage emmental comte camembert mozzarella chevre gruyere oeuf oeufs margarine dessert skyr compote' },
    { id: 'pain', icon: '🥖', name: 'Pain', keywords: 'pain baguette brioche croissant biscotte viennoiserie' },
    { id: 'surgeles', icon: '🧊', name: 'Surgelés', keywords: 'surgele surgeles glace sorbet congele' },
    { id: 'boissons', icon: '🥤', name: 'Boissons', keywords: 'eau jus soda cola limonade sirop biere vin cidre boisson the cafe tisane' },
    { id: 'maison', icon: '🧴', name: 'Maison', keywords: 'savon shampoing shampooing dentifrice brosse deodorant gel lessive adoucissant vaisselle eponge papier essuie mouchoir sopalin nettoyant javel sac couche' },
    { id: 'epicerie', icon: '🥫', name: 'Épicerie', keywords: 'pates spaghetti riz farine sucre sel poivre huile vinaigre moutarde ketchup mayonnaise sauce conserve lentille semoule cereale biscuit chocolat confiture miel bonbon chips gateau' },
    { id: 'autre', icon: '🛒', name: 'Autre', keywords: '' },
  ];

  const INDEX = new Map();
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords.split(' ')) if (keyword) INDEX.set(keyword, category.id);
  }

  function normalizeName(name) {
    return String(name).toLowerCase()
      .replace(/œ/g, 'oe')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function suggestCategory(name) {
    for (const token of normalizeName(name).split(' ')) {
      const singular = token.replace(/[sx]$/, '');
      const match = INDEX.get(token) || INDEX.get(singular);
      if (match) return match;
    }
    return 'autre';
  }

  // Exact d'abord, sinon assez de mots en commun : l'OCR ne relit pas toujours pareil.
  function findInCatalog(catalog, name) {
    const key = normalizeName(name);
    if (!key) return null;
    if (catalog[key]) return { key, entry: catalog[key] };

    const tokens = new Set(key.split(' '));
    let best = null;
    let bestScore = 0.6;
    for (const [otherKey, entry] of Object.entries(catalog)) {
      const other = new Set(otherKey.split(' '));
      const shared = [...tokens].filter((token) => other.has(token)).length;
      const score = shared / new Set([...tokens, ...other]).size;
      if (score >= bestScore) {
        best = { key: otherKey, entry };
        bestScore = score;
      }
    }
    return best;
  }

  root.CATEGORIES = CATEGORIES;
  root.normalizeName = normalizeName;
  root.suggestCategory = suggestCategory;
  root.findInCatalog = findInCatalog;
})(typeof self !== 'undefined' ? self : this);
