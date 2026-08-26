// Bluesky (AT Protocol) publishing client. Raw fetch, no SDK.
//
// WHY NO SDK: the flow is two plain JSON POSTs - com.atproto.server.createSession
// for an access JWT, then com.atproto.repo.createRecord for the post - and we
// build exactly one record type with exactly one facet type. @atproto/api would
// pull a dependency tree (and its RichText detector) to save about thirty lines.
// Same reasoning as the X client, and the same trade accepted knowingly: the
// facet arithmetic below is ours to get right, so it is unit-tested.
//
// Credentials (GitHub Actions secrets):
//   BLUESKY_IDENTIFIER      handle, e.g. memradar.bsky.social
//   BLUESKY_APP_PASSWORD    app password from Settings > Privacy and Security
//                           > App Passwords. NOT the account password.
const PDS = 'https://bsky.social';
// Bluesky counts GRAPHEMES, not code points or bytes.
const POST_MAX_GRAPHEMES = 300;

// Facet offsets are byte offsets into the UTF-8 encoding of the text, NOT JS
// string indices. Our posts open with 📉, which is 4 UTF-8 bytes but 2 UTF-16
// code units, so indexOf()-based offsets would be wrong by 2 and Bluesky would
// slice the link in the wrong place. Everything here goes through Buffer.
function linkFacets(text) {
  const facets = [];
  const re = /https?:\/\/[^\s]+/g;
  let m;
  while ((m = re.exec(text))) {
    const url = m[0];
    // Bytes BEFORE the match = byteStart. Encode the prefix, not the index.
    const byteStart = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(url, 'utf8');
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }
  return facets;
}

// Verifies a facet actually spans its URL in the encoded bytes. Used by the
// dry run so a wrong offset is caught before anything is published.
function describeFacets(text, facets) {
  const buf = Buffer.from(text, 'utf8');
  return facets.map((f) => {
    const sliced = buf.slice(f.index.byteStart, f.index.byteEnd).toString('utf8');
    return {
      byteStart: f.index.byteStart,
      byteEnd: f.index.byteEnd,
      uri: f.features[0].uri,
      slicedBytesDecodeTo: sliced,
      matches: sliced === f.features[0].uri,
    };
  });
}

function graphemeCount(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length; // conservative fallback
}

function requireCreds() {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  const missing = [];
  if (!identifier) missing.push('BLUESKY_IDENTIFIER');
  if (!password) missing.push('BLUESKY_APP_PASSWORD');
  if (missing.length) throw new Error(`Bluesky credentials missing: ${missing.join(', ')}`);
  return { identifier, password };
}

async function createSession() {
  const { identifier, password } = requireCreds();
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Bluesky createSession ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  if (!json.accessJwt || !json.did) throw new Error('Bluesky createSession returned no accessJwt/did');
  return { jwt: json.accessJwt, did: json.did };
}

// Returns { uri, cid, url } - url is the human-facing permalink.
async function postSkeet(text) {
  const graphemes = graphemeCount(text);
  if (graphemes > POST_MAX_GRAPHEMES) {
    throw new Error(`post too long: ${graphemes} graphemes > ${POST_MAX_GRAPHEMES}`);
  }
  const { jwt, did } = await createSession();
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    facets: linkFacets(text),
  };
  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Bluesky createRecord ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  const rkey = (json.uri || '').split('/').pop();
  return {
    uri: json.uri,
    cid: json.cid,
    url: rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : null,
  };
}

module.exports = { postSkeet, linkFacets, describeFacets, graphemeCount, POST_MAX_GRAPHEMES };

// Self-test: node backend/lib/blueskyClient.js
// The emoji case is the whole point: JS indexOf would report 2 fewer bytes.
if (require.main === module) {
  const text = '📉 Biggest drop today: Thing down 5% to $10 at Amazon. https://memradar.com/ram/x/';
  const facets = linkFacets(text);
  const desc = describeFacets(text, facets);
  console.log('facets:', JSON.stringify(desc, null, 2));
  console.assert(facets.length === 1, 'one link facet');
  console.assert(desc[0].matches, 'sliced bytes must decode back to the URL');
  const jsIndex = text.indexOf('https://');
  console.log(`JS string index ${jsIndex} vs UTF-8 byteStart ${facets[0].index.byteStart} (emoji makes these differ by ${facets[0].index.byteStart - jsIndex})`);
  console.assert(facets[0].index.byteStart !== jsIndex, 'the emoji MUST make byte offset differ from the JS index');
  console.assert(graphemeCount('📉 hi') === 4, 'grapheme counting');
  console.log('blueskyClient self-test OK');
}
