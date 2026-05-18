// First test: confirm Best Buy API is working and returning RAM products
require('dotenv').config({ path: '../.env' });

const API_KEY = process.env.BBY_API_KEY;

if (!API_KEY || API_KEY === 'paste_your_best_buy_api_key_here') {
  console.error('ERROR: No API key found. Add your Best Buy API key to the .env file.');
  process.exit(1);
}

const url = `https://api.bestbuy.com/v1/products(categoryPath.id=4606&manufacturer=G.Skill)?format=json&show=sku,name,salePrice,regularPrice,url&pageSize=5&apiKey=${API_KEY}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      console.error('API Error:', data.error);
      return;
    }
    console.log(`SUCCESS! Found ${data.total} products. First 5:\n`);
    data.products.forEach(p => {
      console.log(`  ${p.name}`);
      console.log(`  Price: $${p.salePrice}  |  SKU: ${p.sku}`);
      console.log('');
    });
  })
  .catch(err => console.error('Fetch error:', err.message));
