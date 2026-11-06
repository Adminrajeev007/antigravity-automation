/**
 * Random email generator with culturally consistent first/last names.
 * A year (DOB-like) is embedded in the local part.
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
  var IDENTITIES = [
  {f:["james","john","michael","david","robert","william","emily","sarah","jessica","ashley"],l:["smith","johnson","williams","brown","jones","miller","davis","wilson","moore","taylor"]},
  {f:["carlos","jose","luis","miguel","jorge","diego","maria","sofia","lucia","valentina"],l:["garcia","rodriguez","martinez","hernandez","lopez","gonzalez","perez","sanchez","ramirez","torres"]},
  {f:["lukas","maximilian","felix","jonas","leon","paul","lena","anna","mia","emma"],l:["muller","schmidt","schneider","fischer","weber","meyer","wagner","becker","hoffmann","schulz"]},
  {f:["lucas","hugo","louis","theo","gabriel","arthur","chloe","camille","lea","manon"],l:["martin","bernard","dubois","thomas","robert","richard","petit","durand","leroy","moreau"]},
  {f:["luca","marco","matteo","alessandro","andrea","davide","giulia","sofia","chiara","alice"],l:["rossi","russo","ferrari","esposito","bianchi","romano","colombo","ricci","marino","greco"]},
  {f:["joao","pedro","lucas","mateus","rafael","thiago","ana","mariana","beatriz","camila"],l:["silva","santos","oliveira","souza","rodrigues","ferreira","alves","pereira","lima","carvalho"]},
  {f:["daan","sem","lucas","bram","jesse","thijs","emma","julia","sophie","anna"],l:["dejong","jansen","devries","van den berg","van dijk","bakker","visser","smit","meijer","mulder"]},
  {f:["erik","lars","anders","johan","nils","oskar","elin","anna","lina","maja"],l:["andersson","johansson","karlsson","nilsson","eriksson","larsson","olsson","persson","svensson","gustafsson"]},
  {f:["jakub","jan","piotr","tomasz","michal","kacper","anna","zofia","julia","aleksandra"],l:["nowak","kowalski","wisniewski","wójcik","kowalczyk","kaminski","lewandowski","zielinski","szymanski","wozniak"]},
  {f:["dmitri","ivan","sergei","alexei","nikolai","andrei","olga","natasha","irina","svetlana"],l:["ivanov","smirnov","kuznetsov","popov","vasiliev","petrov","sokolov","mikhailov","novikov","fedorov"]},
  {f:["georgios","nikos","dimitris","kostas","yannis","panos","maria","eleni","sofia","katerina"],l:["papadopoulos","nikolaidis","georgiou","dimitriou","pappas","oikonomou","antoniou","makris","petrou","vlahos"]},
  {f:["mehmet","mustafa","ahmet","emre","burak","can","elif","zeynep","selin","ayse"],l:["yilmaz","kaya","demir","sahin","celik","yildiz","aydin","ozturk","arslan","dogan"]},
  {f:["mohammed","ahmed","ali","omar","youssef","khaled","fatima","aisha","layla","noor"],l:["hassan","hussein","ibrahim","mahmoud","khalil","mansour","saleh","ismail","abdullah","rashid"]},
  {f:["arash","reza","amir","farhad","kamran","sina","sara","nazanin","parisa","leila"],l:["hosseini","mohammadi","ahmadi","rezaei","karimi","moradi","jafari","rahimi","hashemi","sadeghi"]},
  {f:["david","yosef","ariel","moshe","idan","amir","noa","tamar","yael","shira"],l:["cohen","levi","mizrahi","peretz","bitton","dahan","avraham","friedman","shapiro","golan"]},
  {f:["chinedu","emeka","ifeanyi","obinna","tochukwu","kelechi","adaeze","chiamaka","nneka","amara"],l:["okafor","okonkwo","eze","nwosu","obi","adeyemi","balogun","okoro","uche","onwu"]},
  {f:["brian","kevin","dennis","samuel","peter","joseph","grace","mercy","faith","joy"],l:["kamau","otieno","ochieng","mwangi","kariuki","njoroge","mutua","kiptoo","wafula","maina"]},
  {f:["sipho","thabo","mandla","bongani","luthando","sibusiso","naledi","thandi","zanele","lerato"],l:["dlamini","nkomo","nkosi","mahlangu","mbatha","zulu","khumalo","mokoena","molefe","sithole"]},
  {f:["abebe","dawit","samuel","yared","tesfaye","bereket","hanna","marta","selam","liya"],l:["bekele","tesfaye","haile","girma","kebede","mekonnen","asfaw","negash","tekle","abebe"]},
  {f:["wei","ming","jun","hao","lei","chen","jing","yan","mei","xinyi"],l:["wang","li","zhang","liu","chen","yang","huang","zhao","wu","zhou"]},
  {f:["haruto","yuto","sota","ren","kaito","daiki","yui","aiko","sakura","mei"],l:["sato","suzuki","takahashi","tanaka","watanabe","ito","yamamoto","nakamura","kobayashi","kato"]},
  {f:["minjun","jihoon","seojun","doyun","hyunwoo","jisoo","minseo","seoyeon","jiwoo","haeun"],l:["kim","lee","park","choi","jung","kang","cho","yoon","jang","lim"]},
  {f:["minh","duc","huy","quang","tuan","anh","linh","mai","thao","ngoc"],l:["nguyen","tran","le","pham","hoang","huynh","phan","vu","dang","bui"]},
  {f:["jose","juan","carlo","miguel","paolo","maria","anna","angelica","bea","camille"],l:["santos","reyes","cruz","bautista","garcia","mendoza","ramos","aquino","dela cruz","villanueva"]},
  {f:["somchai","niran","kittisak","thanawat","anan","malee","suda","pim","ploy","ning"],l:["srisuk","wongchai","chaiyaporn","sukhum","rungruang","thongchai","kittiwong","phongsri","saelim","boonmee"]},
  {f:["budi","agus","rizky","dimas","fajar","siti","dewi","putri","intan","ayu"],l:["santoso","wijaya","setiawan","kurniawan","hidayat","saputra","pratama","susanto","gunawan","halim"]},
  {f:["ahmed","hassan","usman","bilal","zain","ali","fatima","ayesha","hira","maria"],l:["khan","malik","chaudhry","butt","rana","qureshi","abbasi","sheikh","raza","farooq"]},
  {f:["rafiq","karim","jamal","nasir","shafiq","rahim","nusrat","shirin","taslima","rumana"],l:["rahman","ahmed","hossain","islam","uddin","chowdhury","khan","mia","sarker","bhuiyan"]},
  {f:["kasun","dilan","nuwan","chamara","sahan","nimali","nilmini","tharushi","dilini","hasini"],l:["perera","fernando","silva","jayasinghe","bandara","wanniarachchi","gunasekara","dissanayake","wickramasinghe","rathnayake"]},
  {f:["bibek","sujan","prakash","rajan","nabin","sita","gita","mina","sabina","anita"],l:["sharma","poudel","thapa","adhikari","bhattarai","karki","shrestha","gurung","magar","rai"]},
  {f:["aarav","vivaan","aditya","arjun","rohan","rahul","karan","nikhil","ananya","priya"],l:["sharma","verma","gupta","agarwal","singh","yadav","mishra","pandey","joshi","nair"]},
  {f:["ayaan","imran","zaid","faizan","arif","salman","farhan","ayesha","zara","sana"],l:["khan","ahmed","ali","hussain","sheikh","syed","ansari","qureshi","siddiqui","mirza"]},
  {f:["gurpreet","harpreet","jaspreet","manpreet","navdeep","amrit","jaskaran","simran","gurleen","navneet"],l:["singh","kaur","gill","sandhu","grewal","dhillon","bajwa","sidhu","randhawa","brar"]},
  {f:["john","david","michael","daniel","joseph","thomas","maria","anna","grace","sophia"],l:["fernandes","dsouza","pereira","rodrigues","thomas","mathew","george","joseph","pinto","lobo"]}
];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clean(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function randomLocal(used) {
    for (var attempt = 0; attempt < 120; attempt++) {
      var id = pick(IDENTITIES);
      var first = clean(pick(id.f));
      var last = clean(pick(id.l));
      var year = 1980 + Math.floor(Math.random() * 25); // 1980-2004
      var base = first + "." + last + year;
      var candidates = [base, first + last + year, first + "." + last + "." + year, first + last + year + Math.floor(10 + Math.random() * 90)];
      for (var i = 0; i < candidates.length; i++) if (!used.has(candidates[i])) return candidates[i];
    }
    return "user" + Date.now() + Math.floor(Math.random() * 1000);
  }
  G.gcpRandomEmail = function (used) {
    var set = used instanceof Set ? used : new Set(used || []);
    var local = randomLocal(set);
    var domain = pick(DOMAINS);
    var email = local + "@" + domain;
    var guard = 0;
    while (set.has(email.toLowerCase()) && guard < 100) { domain = pick(DOMAINS); email = local + "@" + domain; guard += 1; }
    return email;
  };
  G.gcpEmailDomains = DOMAINS;
})();
