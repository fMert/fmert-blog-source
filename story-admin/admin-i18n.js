(function () {
  'use strict';

  document.documentElement.style.visibility = 'hidden';
  setTimeout(function () { document.documentElement.style.visibility = ''; }, 1500);
  var style = document.createElement('style');
  style.textContent = '.admin-languages{display:flex;align-items:center;gap:5px}.admin-languages a{display:inline-flex;padding:4px;border-radius:6px;opacity:.65}.admin-languages a:hover,.admin-languages a[aria-current="page"]{opacity:1;background:#2b2b3a}.admin-languages a:focus-visible{outline:2px solid #a78fff}.admin-languages img{width:25px;height:18px}body>.admin-languages{position:fixed;top:16px;right:16px;z-index:50}';
  document.head.appendChild(style);

  var choice = new URLSearchParams(location.search).get('lang');
  var saved;
  try { saved = localStorage.getItem('fmert-admin-lang'); } catch (_) {}
  var lang = ['eo', 'en', 'tr'].includes(choice) ? choice : (['eo', 'en', 'tr'].includes(saved) ? saved : 'eo');
  document.documentElement.lang = lang;
  window.adminLang = lang;
  try { localStorage.setItem('fmert-admin-lang', lang); } catch (_) {}
  document.cookie = 'fmert_admin_lang=' + lang + '; Path=/stories-admin; SameSite=Strict; Secure; Max-Age=31536000';

  // [Turkish source text, Esperanto, English]
  var phrases = [
    ["İçerik stüdyosu · Giriş", "Enhava studio · Ensaluto", "Content studio · Sign in"],
    ["Yönetim paneli", "Administra panelo", "Admin panel"],
    ["İçerik stüdyosu", "Enhava studio", "Content studio"],
    ["Hikâyelerini ve blog yazılarını oluşturmak için giriş yap.", "Ensalutu por krei rakontojn kaj blogaĵojn.", "Sign in to create stories and blog posts."],
    ["Şifre yanlış. Tekrar deneyebilirsin.", "Malĝusta pasvorto. Bonvolu reprovi.", "Incorrect password. Please try again."],
    ["Şifre", "Pasvorto", "Password"],
    ["Göster", "Montri", "Show"],
    ["Gizle", "Kaŝi", "Hide"],
    ["Giriş yap", "Ensaluti", "Sign in"],
    ["İçerik türü", "Enhava tipo", "Content type"],
    ["◉ Hikâyeler", "◉ Rakontoj", "◉ Stories"],
    ["▤ Yazılar", "▤ Afiŝoj", "▤ Posts"],
    ["◫ Analitik", "◫ Analitiko", "◫ Analytics"],
    ["Siteyi aç", "Malfermi retejon", "Open site"],
    ["Çıkış yap", "Elsaluti", "Sign out"],
    ["Site trafiği", "Reteja trafiko", "Site traffic"],
    ["Analitik", "Analitiko", "Analytics"],
    ["Son 30 gün · saatler Türkiye saatiyle", "Lastaj 30 tagoj · horoj laŭ turka tempo", "Last 30 days · times in Türkiye time"],
    ["Beğeniler", "Ŝatoj", "Likes"],
    ["İçerik", "Enhavo", "Content"],
    ["Tür", "Tipo", "Type"],
    ["Beğeni", "Ŝato", "Like"],
    ["Yazı", "Afiŝo", "Post"],
    ["Hikâye", "Rakonto", "Story"],
    ["Henüz beğeni yok.", "Ankoraŭ neniu ŝato.", "No likes yet."],
    ["Beğenen ziyaretçilerin bilgileri", "Informoj pri ŝatintaj vizitantoj", "Details of visitors who liked content"],
    ["Her satır, beğeni anındaki bilgileri gösterir. Aynı IP farklı kişilere ait olabilir. Beğeni geri alındığında bu kayıt silinir.", "Ĉiu vico montras la informojn ĉe la momento de la ŝato. Unu IP-adreso povas aparteni al pluraj homoj. Se la ŝato estas forigita, ankaŭ la registro foriĝas.", "Each row shows information captured when the like was made. One IP may belong to different people. Removing a like deletes its record."],
    ["Zaman", "Tempo", "Time"],
    ["Sayfa", "Paĝo", "Page"],
    ["Cihaz", "Aparato", "Device"],
    ["Tarayıcı", "Retumilo", "Browser"],
    ["Kaynak", "Fonto", "Source"],
    ["Sayfa görüntüleme", "Paĝovidoj", "Page views"],
    ["Farklı IP (kişi sayısı değildir)", "Apartaj IP-adresoj (ne homnombro)", "Distinct IPs (not a people count)"],
    ["Bugünkü görüntüleme", "Hodiaŭaj vidoj", "Views today"],
    ["En çok görüntülenen sayfalar", "Plej vizititaj paĝoj", "Most viewed pages"],
    ["Görüntüleme", "Vidoj", "Views"],
    ["Henüz veri yok", "Ankoraŭ neniuj datumoj", "No data yet"],
    ["Cihazlar ve kaynaklar", "Aparatoj kaj fontoj", "Devices and sources"],
    ["Yönlendiren site", "Referenca retejo", "Referring site"],
    ["Son görüntülemeler", "Lastaj paĝovidoj", "Recent views"],
    ["En yeni 100 kayıt", "Plej novaj 100 registroj", "Latest 100 records"],
    ["Henüz görüntüleme yok", "Ankoraŭ neniu vido", "No views yet"],
    ["Veriler bu özellik yayına alındıktan sonra başlar. IP ve tarayıcı bilgileri yaklaşık olabilir; reklam engelleyiciler ve JavaScript kapalı tarayıcılar sayılmaz. Kayıtlar 30 gün saklanır.", "Datumoj komenciĝas ekde la enkonduko de ĉi tiu funkcio. IP- kaj retumilaj informoj povas esti proksimumaj; reklamblokiloj kaj retumiloj sen JavaScript ne estas kalkulataj. Registroj konserviĝas dum 30 tagoj.", "Data starts when this feature goes live. IP and browser information may be approximate; ad blockers and browsers without JavaScript are not counted. Records are kept for 30 days."],
    ["Yeni blog yazısı", "Nova blogaĵo", "New blog post"],
    ["Markdown ile yaz, tek dokunuşla yayınla", "Verku per Markdown kaj publikigu per unu tuŝo", "Write in Markdown and publish with one tap"],
    ["Tarih, bağlantı, kategori ve etiketler içeriğine göre otomatik hazırlanır.", "Dato, ligilo, kategorio kaj etikedoj estas aŭtomate preparataj laŭ la enhavo.", "Date, link, category, and tags are prepared automatically from your content."],
    ["Yazı servisi hazır", "Afiŝa servo preta", "Post service ready"],
    ["Taslak bu cihazda saklanır", "Malneto konserviĝas en ĉi tiu aparato", "Draft saved on this device"],
    ["Başlık", "Titolo", "Title"],
    ["Markdown içerik", "Markdown-enhavo", "Markdown content"],
    ["karakter", "signoj", "characters"],
    ["Markdown araçları", "Markdown-iloj", "Markdown tools"],
    ["Kalın", "Grasa", "Bold"],
    ["İtalik", "Kursiva", "Italic"],
    ["Bağlantı", "Ligilo", "Link"],
    ["Liste", "Listo", "List"],
    ["Alıntı", "Citaĵo", "Quote"],
    ["Kod bloğu", "Kodbloko", "Code block"],
    ["English · title", "Angla · titolo", "English · title"],
    ["English · Markdown", "Angla · Markdown", "English · Markdown"],
    ["Türkçe · başlık", "Turka · titolo", "Turkish · title"],
    ["Türkçe · Markdown", "Turka · Markdown", "Turkish · Markdown"],
    ["Tarih", "Dato", "Date"],
    ["Bugün · otomatik", "Hodiaŭ · aŭtomate", "Today · automatic"],
    ["Kategori", "Kategorio", "Category"],
    ["Genel", "Ĝenerala", "General"],
    ["Proje", "Projekto", "Project"],
    ["Araştırma", "Esploro", "Research"],
    ["Yazılım", "Programado", "Software"],
    ["Etiketler", "Etikedoj", "Tags"],
    ["İçeriğe göre", "Laŭ enhavo", "Based on content"],
    ["Kategori ve etiketler yerleşik içerik analizine göre belirlenir; ayrıca bir API anahtarı gerekmez.", "Kategorio kaj etikedoj estas elektataj per enkonstruita enhavanalizo; aparta API-ŝlosilo ne necesas.", "Category and tags are chosen by built-in content analysis; no separate API key is needed."],
    ["Dosya adı ve yayın tarihi otomatik oluşturulur.", "Dosiernomo kaj publikiga dato kreiĝas aŭtomate.", "File name and publication date are created automatically."],
    ["Yayınlama genellikle bir dakika içinde tamamlanır.", "Publikigo kutime finiĝas ene de unu minuto.", "Publishing usually finishes within a minute."],
    ["Yazıyı yayınla", "Publikigi afiŝon", "Publish post"],
    ["Canlı önizleme", "Tuja antaŭrigardo", "Live preview"],
    ["Blogdaki yaklaşık görünüm", "Proksimuma bloga aspekto", "Approximate blog appearance"],
    ["Bugün", "Hodiaŭ", "Today"],
    ["Yazının başlığı", "Titolo de la afiŝo", "Post title"],
    ["Markdown içeriğini yazdıkça önizleme burada güncellenir.", "La antaŭrigardo ĉi tie ĝisdatigas sin dum vi verkas Markdown.", "The preview updates here as you write Markdown."],
    ["Önizleme hızlı bir taslaktır; kod vurgulama gibi ayrıntılar canlı sitede tamamlanır.", "La antaŭrigardo estas rapida skizo; detaloj kiel kodkolorigo aperas en la publika retejo.", "The preview is a quick draft; details such as code highlighting appear on the live site."],
    ["Panelden yayınlanan yazılar", "Afiŝoj publikigitaj el la panelo", "Posts published from the panel"],
    ["Henüz panelden yayınlanan yazı yok", "Ankoraŭ neniu afiŝo publikigita el la panelo", "No posts published from the panel yet"],
    ["İlk Markdown yazını yukarıdaki düzenleyiciden yayınlayabilirsin.", "Vi povas publikigi vian unuan Markdown-afiŝon per la supra redaktilo.", "You can publish your first Markdown post from the editor above."],
    ["Yeni paylaşım", "Nova publikigo", "New update"],
    ["Bir hikâye oluştur", "Krei rakonton", "Create a story"],
    ["İçeriğini ekle, önizle ve tek dokunuşla yayınla.", "Aldonu enhavon, antaŭrigardu kaj publikigu per unu tuŝo.", "Add content, preview it, and publish with one tap."],
    ["Hikâye servisi hazır", "Rakarta servo preta", "Story service ready"],
    ["Taslak otomatik kaydedilir", "Malneto konserviĝas aŭtomate", "Draft saved automatically"],
    ["Hikâye türü", "Tipo de rakonto", "Story type"],
    ["Metin", "Teksto", "Text"],
    ["FOTOĞRAF", "FOTO", "PHOTO"],
    ["BAĞLANTI", "LIGILO", "LINK"],
    ["Aç", "Malfermi", "Open"],
    ["Fotoğraf", "Foto", "Photo"],
    ["Ana metin", "Ĉefa teksto", "Main text"],
    ["English · main text", "Angla · ĉefa teksto", "English · main text"],
    ["Türkçe · ana metin", "Turka · ĉefa teksto", "Turkish · main text"],
    ["Fotoğraf seç veya buraya bırak", "Elektu foton aŭ lasu ĝin ĉi tie", "Choose a photo or drop it here"],
    ["JPEG, PNG, WebP veya GIF · en fazla 10 MB", "JPEG, PNG, WebP aŭ GIF · maksimume 10 MB", "JPEG, PNG, WebP or GIF · up to 10 MB"],
    ["Arka plan", "Fono", "Background"],
    ["Arka plan seçenekleri", "Fonaj elektoj", "Background options"],
    ["Gece moru", "Nokta purpuro", "Night purple"],
    ["Gün batımı", "Sunsubiro", "Sunset"],
    ["Okyanus", "Oceano", "Ocean"],
    ["Orman", "Arbaro", "Forest"],
    ["Kömür", "Karbo", "Charcoal"],
    ["Düğme metni (Esperanto)", "Butona teksto (Esperanto)", "Button label (Esperanto)"],
    ["Button label (English)", "Butona teksto (angla)", "Button label (English)"],
    ["Düğme metni (Türkçe)", "Butona teksto (turka)", "Button label (Turkish)"],
    ["İsteğe bağlı alanlar", "Laŭvolaj kampoj", "Optional fields"],
    ["Kart başlığı", "Karta titolo", "Card title"],
    ["İsteğe bağlı", "Laŭvola", "Optional"],
    ["Alt metin", "Subteksto", "Subtitle"],
    ["Card title (English)", "Karta titolo (angla)", "Card title (English)"],
    ["Subtitle (English)", "Subteksto (angla)", "Subtitle (English)"],
    ["Kart başlığı (Türkçe)", "Karta titolo (turka)", "Card title (Turkish)"],
    ["Alt metin (Türkçe)", "Subteksto (turka)", "Subtitle (Turkish)"],
    ["Özel CSS arka planı", "Propra CSS-fono", "Custom CSS background"],
    ["Yayın saati otomatik eklenir.", "La publikiga horo aldoniĝas aŭtomate.", "Publication time is added automatically."],
    ["Hikâye 24 saat boyunca yeni görünür.", "La rakonto aperas kiel nova dum 24 horoj.", "The story appears as new for 24 hours."],
    ["Şimdi yayınla", "Publikigi nun", "Publish now"],
    ["Takipçilerinin göreceği biçim", "Kiel vizitantoj vidos ĝin", "How visitors will see it"],
    ["Seçilen fotoğrafın önizlemesi", "Antaŭrigardo de la elektita foto", "Preview of the selected photo"],
    ["Şimdi", "Nun", "Now"],
    ["METİN", "TEKSTO", "TEXT"],
    ["Hikâyen burada görünecek", "Via rakonto aperos ĉi tie", "Your story will appear here"],
    ["Yazdıkça önizleme anında güncellenir.", "La antaŭrigardo tuj ŝanĝiĝas dum vi verkas.", "The preview updates as you type."],
    ["Bağlantıyı aç ↑", "Malfermi ligilon ↑", "Open link ↑"],
    ["İpucu: Kısa ve net metinler mobil ekranda daha güçlü görünür.", "Konsilo: mallongaj, klaraj tekstoj pli bone funkcias sur poŝtelefonoj.", "Tip: short, clear text works better on mobile screens."],
    ["Yayınlanan hikâyeler", "Publikigitaj rakontoj", "Published stories"],
    ["Yeni", "Nova", "New"],
    ["Arşiv", "Arkivo", "Archive"],
    ["Henüz hikâye yok", "Ankoraŭ neniu rakonto", "No stories yet"],
    ["İlk hikâyeni yukarıdaki oluşturucudan yayınlayabilirsin.", "Vi povas publikigi vian unuan rakonton per la supra formularo.", "You can publish your first story from the form above."],
    ["Hikâyeyi sil", "Forigi rakonton", "Delete story"],
    ["Yazının dikkat çekici başlığı", "Alloga titolo por la afiŝo", "An engaging title for the post"],
    ["English title", "Angla titolo", "English title"],
    ["Write the complete English translation here.", "Skribu ĉi tie la tutan anglan tradukon.", "Write the complete English translation here."],
    ["Türkçe başlık", "Turka titolo", "Turkish title"],
    ["Türkçe çevirinin tamamını buraya yaz.", "Skribu ĉi tie la tutan turkan tradukon.", "Write the complete Turkish translation here."],
    ["What would you like to share?", "Kion vi volas kundividi?", "What would you like to share?"],
    ["Aç ↑", "Malfermi ↑", "Open ↑"],
    ["# Giriş\n\nYazını Markdown formatında buraya yaz…", "# Enkonduko\n\nSkribu vian afiŝon per Markdown ĉi tie…", "# Introduction\n\nWrite your post in Markdown here…"],
    ["# Giriş\n\nYazını Markdown formatında buraya yaz…".replace(/\n/g, '&#10;'), "# Enkonduko&#10;&#10;Skribu vian afiŝon per Markdown ĉi tie…", "# Introduction&#10;&#10;Write your post in Markdown here…"],
    ["Ne paylaşmak istiyorsun?", "Kion vi volas kundividi?", "What would you like to share?"],
    ["Ana sayfadaki kısa başlık", "Mallonga titolo por la hejmpaĝo", "Short title on the homepage"],
    ["Kısa bir açıklama", "Mallonga priskribo", "A short description"],
    ["Fotoğraf 10 MB sınırını aşıyor.", "La foto superas la limon de 10 MB.", "The photo exceeds the 10 MB limit."],
    ["Hikâye yayınlandı", "Rakonto publikigita", "Story published"],
    ["Hikâye yayınlanamadı.", "Ne eblis publikigi la rakonton.", "Could not publish the story."],
    ["Yayınlanıyor…", "Publikigado…", "Publishing…"],
    ["Kaydediliyor…", "Konservado…", "Saving…"],
    ["Yazı kaydedildi, blog hazırlanıyor…", "Afiŝo konservita; la blogo konstruiĝas…", "Post saved; the blog is building…"],
    ["Yazı kaydedildi ancak yayınlama beklenenden uzun sürüyor. Biraz sonra siteyi kontrol edebilirsin.", "La afiŝo estas konservita, sed publikigo daŭras pli longe ol atendite. Kontrolu la retejon poste.", "The post was saved, but publishing is taking longer than expected. Check the site later."],
    ["Yazı yayında.", "La afiŝo estas publikigita.", "The post is live."],
    ["Yazıyı aç ↗", "Malfermi afiŝon ↗", "Open post ↗"],
    ["Yeniden dene", "Reprovi", "Retry"],
    ["Yayınlandı", "Publikigita", "Published"],
    ["Blog hazırlanıyor…", "La blogo konstruiĝas…", "The blog is building…"],
    ["Yazı kaydedilemedi.", "Ne eblis konservi la afiŝon.", "Could not save the post."],
    ["Yayınlama sırasında bir sorun oluştu.", "Eraro okazis dum publikigo.", "An error occurred during publishing."],
    ["Bu hikâyeyi kalıcı olarak silmek istiyor musun?", "Ĉu vi volas porĉiame forigi ĉi tiun rakonton?", "Do you want to permanently delete this story?"],
    ["Yazı yayın kuyruğunda", "Afiŝo atendas publikigon", "Post queued for publishing"],
    ["Blog hazırlanıyor", "La blogo konstruiĝas", "The blog is building"],
    ["Blog oluşturulamadı; mevcut site değişmeden kaldı", "Ne eblis konstrui la blogon; la nuna retejo restas senŝanĝa", "Could not build the blog; the current site is unchanged"],
    ["Yeni sürüm başlatılamadı; önceki sürüm korundu", "Ne eblis lanĉi la novan version; la antaŭa versio restas", "Could not start the new version; the previous version remains"],
    ["Sağlık kontrolü başarısız oldu; önceki sürüm geri yüklendi", "La funkcia kontrolo malsukcesis; la antaŭa versio estis restarigita", "Health check failed; the previous version was restored"],
    ["Yazı yayında", "Afiŝo publikigita", "Post live"],
    ["Geçersiz yayın isteği", "Nevalida publikiga peto", "Invalid publishing request"],
    ["Oturum süresi doldu", "La seanco eksvalidiĝis", "Your session has expired"],
    ["Yazı verileri okunamadı", "Ne eblis legi la afiŝajn datumojn", "Could not read post data"],
    ["Başlık zorunludur ve en fazla 160 karakter olabilir", "Titolo estas deviga kaj povas havi maksimume 160 signojn", "A title is required and may be at most 160 characters"],
    ["Markdown içeriği zorunludur ve en fazla 200.000 karakter olabilir", "Markdown-enhavo estas deviga kaj povas havi maksimume 200 000 signojn", "Markdown content is required and may be at most 200,000 characters"],
    ["Her dilde başlık ve içerik gereklidir", "Titolo kaj enhavo necesas en ĉiu lingvo", "A title and content are required in every language"],
    ["Her dilde metin gereklidir", "Teksto necesas en ĉiu lingvo", "Text is required in every language"],
    ["Yazı dizini oluşturulamadı", "Ne eblis krei la afiŝan dosierujon", "Could not create the post directory"],
    ["Yazı dosyası hazırlanamadı", "Ne eblis prepari la afiŝan dosieron", "Could not prepare the post file"],
    ["Yazı kaydedilemedi", "Ne eblis konservi la afiŝon", "Could not save the post"],
    ["Yazı yayın kuyruğuna alınamadı", "Ne eblis aldoni la afiŝon al la publikiga atendovico", "Could not queue the post for publishing"],
    ["Yayın durumu kaydedilemedi", "Ne eblis konservi la publikigan staton", "Could not save publishing status"],
    ["Yayın işlemi başlatılamadı", "Ne eblis komenci publikigon", "Could not start publishing"],
    ["İçerik okunamadı", "Ne eblis legi la enhavon", "Could not read content"],
    ["Yayın durumu okunamadı", "Ne eblis legi la publikigan staton", "Could not read publishing status"],
    ["Yüklenen dosya çok büyük (en fazla 10 MB)", "La alŝutita dosiero estas tro granda (maksimume 10 MB)", "The uploaded file is too large (10 MB maximum)"],
    ["Görsel okunamadı", "Ne eblis legi la bildon", "Could not read the image"],
    ["Fotoğraf türündeki hikâyeler için görsel gereklidir", "Fota rakonto bezonas bildon", "Photo stories require an image"],
    ["Hikâye kaydedilemedi", "Ne eblis konservi la rakonton", "Could not save the story"],
    ["Hikâye silinemedi", "Ne eblis forigi la rakonton", "Could not delete the story"],
    ["Hikâyeler yüklenemedi", "Ne eblis ŝargi la rakontojn", "Could not load stories"],
    ["Yazılar yüklenemedi", "Ne eblis ŝargi la afiŝojn", "Could not load posts"],
    ["Analitik yüklenemedi", "Ne eblis ŝargi analitikajn datumojn", "Could not load analytics"],
    ["Beğeniler yüklenemedi", "Ne eblis ŝargi la ŝatojn", "Could not load likes"],
    ["geçersiz hikâye türü", "nevalida rakonta tipo", "invalid story type"],
    ["zorunlu metin eksik veya alanlardan biri çok uzun", "deviga teksto mankas aŭ kampo estas tro longa", "required text is missing or a field is too long"],
    ["bağlantı /, http:// veya https:// ile başlamalıdır", "la ligilo devas komenciĝi per /, http:// aŭ https://", "the link must start with /, http://, or https://"],
    ["görsel çok büyük (en fazla 10 MB)", "bildo estas tro granda (maksimume 10 MB)", "image is too large (10 MB maximum)"],
    ["görsel JPEG, PNG, WebP veya GIF biçiminde olmalıdır", "bildo devas esti JPEG, PNG, WebP aŭ GIF", "image must be JPEG, PNG, WebP, or GIF"],
    ["Şifre yanlış", "Malĝusta pasvorto", "Incorrect password"],
    ["Doğrudan / bilinmiyor", "Rekte / nekonate", "Direct / unknown"],
    ["Bilinmiyor", "Nekonata", "Unknown"],
    ["Masaüstü", "Labortablo", "Desktop"],
    ["Tablet", "Tabulkomputilo", "Tablet"],
    ["Mobil", "Poŝtelefono", "Mobile"],
    ["Diğer", "Alia", "Other"]
  ];
  var index = lang === 'eo' ? 1 : 2;
  var dictionary = new Map(phrases.map(function (entry) { return [entry[0], entry[index]]; }));

  function translate(value) {
    if (lang === 'tr') return value;
    if (dictionary.has(value)) return dictionary.get(value);
    var count = value.match(/^(\d+) toplam beğeni · tüm zamanlar$/);
    if (count) return lang === 'eo' ? count[1] + ' ŝatoj · ĉiuj tempoj' : count[1] + ' likes · all time';
    count = value.match(/^(\d+) (yazı|hikâye)$/);
    if (count) return count[1] + ' ' + (count[2] === 'yazı' ? (lang === 'eo' ? 'afiŝoj' : 'posts') : (lang === 'eo' ? 'rakontoj' : 'stories'));
    count = value.match(/^Beğenen ziyaretçilerin bilgileri \((\d+)\)$/);
    if (count) return dictionary.get('Beğenen ziyaretçilerin bilgileri') + ' (' + count[1] + ')';
    return value;
  }
  window.adminT = translate;

  function translateText(node) {
    if (node.parentElement && node.parentElement.closest('script,style,textarea')) return;
    var original = node.nodeValue;
    var trimmed = original.trim();
    if (trimmed) {
      var translated = translate(trimmed);
      if (translated !== trimmed) node.nodeValue = original.replace(trimmed, translated);
    }
  }

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateText(walker.currentNode);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.createElement('nav');
    nav.className = 'admin-languages';
    nav.setAttribute('aria-label', lang === 'eo' ? 'Lingvo' : lang === 'en' ? 'Language' : 'Dil');
    [['eo', 'Esperanto'], ['en', 'English'], ['tr', 'Türkçe']].forEach(function (item) {
      var link = document.createElement('a');
      var target = new URL(location.href);
      target.searchParams.set('lang', item[0]);
      link.href = target.pathname + target.search;
      link.setAttribute('aria-label', item[1]);
      link.hreflang = item[0];
      if (lang === item[0]) link.setAttribute('aria-current', 'page');
      var img = document.createElement('img');
      img.src = '/assets/img/flag-' + item[0] + '.svg';
      img.alt = '';
      link.appendChild(img);
      nav.appendChild(link);
    });
    (document.querySelector('.top-actions') || document.body).prepend(nav);
    var openSite = document.querySelector('.ghost[href="/"]');
    if (openSite) openSite.href = lang === 'eo' ? '/' : '/' + lang + '/';

    translateTree(document.body);
    document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(function (element) {
      ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (name) {
        if (element.hasAttribute(name)) element.setAttribute(name, translate(element.getAttribute(name)));
      });
    });
    document.title = translate(document.title);
    document.documentElement.dataset.translated = 'true';
    document.documentElement.style.visibility = '';
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') translateText(mutation.target);
        else mutation.addedNodes.forEach(translateTree);
      });
    }).observe(document.body, {subtree: true, childList: true, characterData: true});
  });
}());
