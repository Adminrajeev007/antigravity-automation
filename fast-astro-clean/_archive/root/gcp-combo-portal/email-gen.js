/**
 * Random email generator (additive).
 *
 * Domains: the list supplied by the user.
 * Names: Hindu / Muslim / Sikh / Christian first + last names, mixed into
 * combinations, plus a 4-digit year of birth. A persistent history and a
 * collision suffix guarantee no two generated emails in this profile repeat.
 */
(function () {
  var G = typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this);
  var DOMAINS = [
    "algonesthub.org", "bytequanta.org", "bytezenith.org", "algovertex.org",
    "nexaravox.org", "bytesummit.org", "codeglyph.org", "hackingtect.site",
    "bitpulsenet.org", "coreglint.org", "ngetek.com", "devblink.org",
    "devluxe.org", "algovortex.org", "techvireo.org", "kuber2x.online",
    "technimbus.org", "web3tekx.com", "byteglintpro.org", "kuberearn.online",
    "techsera.org", "codeninnja.online", "devopsnimble.com", "clonessh.com",
    "techvantax.com", "scriptblink.org", "cyberluxe.org", "ncltek.com",
    "devopscore.org", "innoloom.org", "algocrate.org", "savanahseeds.com",
    "scriptsprint.org", "scriptglint.org", "devvertex.org", "sqlpg.com",
    "bitmeld.org", "apphive.org", "cyberstrive.org", "scriptaura.org",
    "cybervanta.org", "kuberx.online", "furryx.dev", "cloudpulsepro.com",
    "technimbl.org", "codecrux.org", "techblink.org", "codestride.org",
    "scriptquanta.org", "coderafter.org", "opsnexis.org", "algostrive.org",
    "algovibe.org", "bytecrafty.org", "cryptixis.org", "bitluxe.org",
    "bitspry.org", "notebookllm.org", "devaxis.org", "bytevolt.org",
    "technexishub.org", "devopshub.org", "enewvission.org", "devopstrail.org",
    "algoquanta.org", "devsentry.org", "devopsnexa.org", "techhivex.org",
    "codefuze.org", "devmosaic.org", "cybermotive.org", "scriptglide.org",
    "byteglide.org", "cybrantix.org", "techlura.org", "netspry.org",
    "help-bot.org", "bytevibe.org", "devglide.org", "geniai0.org",
    "mescasoft.org", "scriptbloom.org", "techaxiom.org", "algoforgenet.org",
    "dnewcloud.org", "algoflick.org", "bytevortex.org", "techquill.org",
    "devvortex.org", "codezephyr.org", "devnexis.org", "netnexa.org",
    "cybernestnet.org", "corevireo.org", "cloudsynth.org", "patnatech.org",
    "opslynx.org", "devhalo.org", "opsnexa.org", "opsnimble.org",
    "algonimble.org", "cybrazehub.org", "algohivehub.org", "devbeacon.org",
    "cloudnexis.org", "algonimbus.org", "devopshive.org", "byteglint.org",
    "devvanta.org", "codehelix.org", "netfuze.org", "codeflick.org",
    "scriptnestnet.org", "scriptpulsenet.org", "logichive.org", "cloudquanta.org",
    "cybranta.org", "dataglint.org", "cyberfuze.org", "techsynth.org",
    "devsparkle.org", "codeflect.org", "devopsnest.org", "bithatch.org",
    "codevox.org", "algoglide.org", "cyberaxiom.org", "techcrest.org",
    "devorbix.org", "cyberdevops.org", "techkernel.org", "virova.org",
    "patnadev.org", "devopsloom.org", "codemotive.org", "bitstrive.org",
    "codeglyphs.org", "corefuze.org", "algospark.org", "algospry.org",
    "cybernovae.org", "algocrux.org", "techbeacon.org", "itnimble.org",
    "codespritz.org"
  ];

  var FIRST = {
    hindu: [
      "aarav", "vivaan", "aditya", "arjun", "rohan", "rahul", "karan",
      "nikhil", "sanjay", "vikram", "deepak", "manish", "suresh", "ramesh",
      "amit", "rajesh", "ananya", "priya", "neha", "pooja", "sneha", "kavya",
      "meera", "divya", "aarti", "ishita", "riya", "shreya", "anjali", "sunita"
    ],
    muslim: [
      "ayaan", "imran", "zaid", "faizan", "arif", "salman", "farhan", "irfan",
      "adnan", "sameer", "bilal", "usman", "tariq", "rizwan", "ayesha",
      "fatima", "zara", "sana", "rida", "nida", "hina", "mariam", "alina",
      "iqra", "shabnam", "noor", "amna", "huma", "sadia", "zoya"
    ],
    sikh: [
      "gurpreet", "harpreet", "jaspreet", "manpreet", "navdeep", "amrit",
      "jaskaran", "arjan", "gagan", "prabhjot", "tejinder", "sukhwinder",
      "harjot", "meet", "ekam", "simran", "kiran", "raman", "jasleen",
      "gurleen", "navneet", "harleen", "manjot", "seerat", "jasnoor"
    ],
    christian: [
      "john", "david", "michael", "daniel", "joseph", "thomas", "peter",
      "james", "samuel", "joshua", "vincent", "anthony", "george", "paul",
      "steven", "maria", "anna", "grace", "mary", "sarah", "rebecca",
      "rachel", "elizabeth", "christina", "angela", "julia", "sophia", "emily"
    ]
  };

  var LAST = {
    hindu: [
      "sharma", "verma", "gupta", "agarwal", "singh", "yadav", "mishra",
      "pandey", "joshi", "nair", "reddy", "rao", "iyer", "mehta", "shah",
      "patel", "chauhan", "tiwari", "bhat", "desai"
    ],
    muslim: [
      "khan", "ahmed", "ali", "hussain", "sheikh", "syed", "ansari",
      "qureshi", "siddiqui", "shaikh", "mirza", "malik", "pathan",
      "farooqui", "rizvi"
    ],
    sikh: [
      "singh", "kaur", "gill", "sandhu", "grewal", "dhillon", "bajwa",
      "sidhu", "randhawa", "mann", "brar", "sekhon"
    ],
    christian: [
      "fernandes", "dsouza", "pereira", "rodrigues", "thomas", "mathew",
      "george", "joseph", "jacob", "john", "williams", "brown", "taylor",
      "pinto", "lobo", "sequeira"
    ]
  };

  var GROUPS = ["hindu", "muslim", "sikh", "christian"];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clean(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  function randomLocal(used) {
    for (var attempt = 0; attempt < 80; attempt++) {
      var firstGroup = pick(GROUPS);
      var lastGroup = pick(GROUPS); // mixed-culture combo
      var first = clean(pick(FIRST[firstGroup]));
      var last = clean(pick(LAST[lastGroup]));
      var year = 1985 + Math.floor(Math.random() * 20); // 1985-2004
      var base = first + "." + last + year;
      var candidates = [
        base,
        first + last + year,
        first + "." + last + "." + year,
        first + last + year + Math.floor(10 + Math.random() * 90)
      ];
      for (var i = 0; i < candidates.length; i++) {
        if (!used.has(candidates[i])) return candidates[i];
      }
    }
    return "user" + Date.now() + Math.floor(Math.random() * 1000);
  }

  // Returns a full email guaranteed not to be in `used` (a Set of lowercased emails).
  G.gcpRandomEmail = function (used) {
    var set = used instanceof Set ? used : new Set(used || []);
    var local = randomLocal(set);
    var domain = pick(DOMAINS);
    var email = local + "@" + domain;
    var guard = 0;
    while (set.has(email.toLowerCase()) && guard < 100) {
      domain = pick(DOMAINS);
      email = local + "@" + domain;
      guard += 1;
    }
    if (set.has(email.toLowerCase())) {
      email = local + Math.floor(1000 + Math.random() * 9000) + "@" + pick(DOMAINS);
    }
    return email;
  };

  G.gcpEmailDomains = DOMAINS;
})();
