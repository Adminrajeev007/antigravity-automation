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
    "codespritz.org", "algentis.org", "algobeacon.org", "algoblink.org",
    "algocraft.org", "algocrafty.org", "algodyna.org", "algoflux.org",
    "algofuse.org", "algoglint.org", "algoglow.org", "algoharbor.org",
    "algohaven.org", "algohive.org", "algoloom.org", "algoluxe.org",
    "algomatrix.org", "algomint.org", "algonest.org", "algonexa.org",
    "algoorbit.org", "algoquill.org", "algosprint.org", "algostream.org",
    "algostride.org", "algosynth.org", "algovanta.org", "algozen.org",
    "algozenith.org", "algvex.org", "always4.org", "astroaitech.org",
    "bitaura.org", "bitcrest.org", "bitcrux.org", "bitcrypta.org",
    "bitglide.org", "bitglintnet.org", "bitloom.org", "bitnimble.org",
    "bitquill.org", "bitsprint.org", "bitsprout.org", "bitsynth.org",
    "bitvanta.org", "bitvora.org", "bitvortex.org", "bitzenith.org",
    "bytecraze.org", "bytecrest.org", "bytecrux.org", "bytefuze.org",
    "byteglyph.org", "bytehatch.org", "byteluxe.org", "bytenexus.org",
    "bytenova.org", "bytepulsenet.org", "bytesprint.org", "bytesynth.org",
    "bytevanta.org", "bytevera.org", "bytevex.org", "bytevista.org",
    "cloudbeacon.org", "cloudlyst.org", "cloudstrix.org", "cloudsurge.org",
    "codalis.org", "codeaxiom.org", "codeblink.org", "codeglide.org",
    "codeglint.org", "codeglow.org", "codelyric.org", "codemeld.org",
    "codemosaic.org", "codenimbus.org", "codepatna.org", "codeplexus.org",
    "codequanta.org", "coderift.org", "codespry.org", "codestratus.org",
    "codestrive.org", "codetrail.org", "codevireo.org", "coreaura.org",
    "coreblink.org", "corecrux.org", "coreglyph.org", "corehatch.org",
    "coreluxe.org", "coremint.org", "corenimble.org", "corequanta.org",
    "corequest.org", "coresprint.org", "coresynth.org", "corevertex.org",
    "corezenith.org", "cryptvia.org", "cyberaegis.org", "cybercrux.org",
    "cyberfleck.org", "cyberfluent.org", "cyberglide.org", "cyberglint.org",
    "cybermeld.org", "cybermint.org", "cybernimble.org", "cyberpatna.org",
    "cyberpulsex.com", "cyberquanta.org", "cyberquill.org", "cybersynth.org",
    "cybersynthx.org", "cybervibe.org", "cyberzenith.org", "cybrance.org",
    "cybrant.org", "cybraze.org", "cybrillo.org", "cybrova.org",
    "dataglide.org", "datanimble.org", "dataquill.org", "datasynth.org",
    "devaura.org", "devaurahub.org", "devaxion.org", "devcrest.org",
    "devcrux.org", "devglint.org", "devglow.org", "devglyph.org",
    "devhatch.org", "devhaven.org", "devinnovation.org", "devlynx.org",
    "devmotive.org", "devnexia.org", "devnimble.org", "devnook.org",
    "devnova.org", "devopsbeacon.org", "devopsia.org", "devopsiq.org",
    "devopspulse.org", "devpatna.org", "devpulsex.org", "devquanta.org",
    "devsolis.org", "devspectra.org", "devstride.org", "devsurge.org",
    "devsynapse.org", "devsynth.org", "devsynthx.org", "devsyte.org",
    "devvibe.org", "devzenith.org", "everyai4all.org", "innovanta.org",
    "logicquest.org", "mark-et.org", "netaura.org", "netcrate.org",
    "netcrypta.org", "netglide.org", "netglint.org", "nethatch.org",
    "netloom.org", "netluxe.org", "netquill.org", "netsprint.org",
    "netstride.org", "netsynth.org", "netvista.org", "opencodehub.org",
    "opshalox.org", "opsnova.org", "opsspark.org", "opssynth.org",
    "opsvanta.org", "opsvox.org", "patnacyber.org", "scriptcrux.org",
    "scriptflux.org", "scriptglow.org", "scripthatch.org", "scriptix.org",
    "scriptloom.org", "scriptmint.org", "scriptnest.org", "scriptnesthub.org",
    "scriptnexus.org", "scriptnimble.org", "scriptnova.org", "scriptrise.org",
    "scriptsummit.org", "scriptvanta.org", "scriptvibe.org", "scriptvista.org",
    "scriptvortex.org", "techaiforum.org", "techaura.org", "techaxion.org",
    "techcrate.org", "techcraze.org", "techcrysta.org", "techglyph.org",
    "techhalo.org", "techlance.org", "techluxe.org", "techlynx.org",
    "techmeld.org", "technesthub.org", "technexa.org", "technexis.org",
    "technimble.org", "techpulsenet.org", "techquanta.org", "techriven.org",
    "techspry.org", "techstra.org", "techvance.org", "techvex.org",
    "techvra.org", "turtlecode.org", "voltnest.org", "zyntek.org",
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
