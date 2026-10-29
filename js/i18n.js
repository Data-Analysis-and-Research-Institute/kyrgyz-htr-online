/* Interface language: Kyrgyz, Russian or English.
 * Default = the operating-system / browser language (ky -> Kyrgyz, ru -> Russian, anything else -> English);
 * the header dropdown overrides it and the choice is remembered; ?lang=ky|ru|en in the URL wins.
 * Static text: data-i18n="key" (text), data-i18n-html="key" (markup), data-i18n-title / -placeholder (attributes),
 * long blocks with one element per language: data-lang="ky|ru|en" (shown by CSS for the current language).
 * Scripts: KHTR.t(key, ...args); listen to the 'khtr:lang' event to redraw dynamic text.
 * The Kyrgyz and Russian texts should be checked by native speakers. */
(function (root) {
  'use strict';
  const LANGS = { ky: 'Кыргызча', ru: 'Русский', en: 'English' };
  const KEY = 'khtr_ui_lang';

  const D = {
    // ---- common ------------------------------------------------------------------------------
    'nav.recognize': { ky: 'Таануу', ru: 'Распознавание', en: 'Recognize' },
    'nav.page': { ky: 'Барак', ru: 'Страница', en: 'Page' },
    'nav.contribute': { ky: 'Маалымат берүү', ru: 'Сбор почерка', en: 'Contribute' },
    'nav.validate': { ky: 'Текшерүү', ru: 'Проверка', en: 'Validate' },
    'nav.admin': { ky: 'Админ', ru: 'Админ', en: 'Admin' },
    'lang.label': { ky: 'Тил', ru: 'Язык', en: 'Language' },
    'signin': { ky: 'Google менен кирүү', ru: 'Войти через Google', en: 'Sign in with Google' },
    'signout': { ky: 'Чыгуу', ru: 'Выйти', en: 'Sign out' },
    'lexicon': { ky: 'Сөздүк менен оңдоо', ru: 'Исправление по словарю', en: 'Word-list correction' },
    'undo': { ky: '↶ Артка', ru: '↶ Отменить', en: '↶ Undo' },
    'clear': { ky: 'Тазалоо', ru: 'Очистить', en: 'Clear' },
    'recognize': { ky: 'Таануу', ru: 'Распознать', en: 'Recognize' },
    'st.loading': { ky: 'Жүктөлүүдө…', ru: 'Загрузка…', en: 'Loading…' },
    'st.loadingModel': { ky: 'Модель жүктөлүүдө…', ru: 'Загрузка модели…', en: 'Loading model…' },
    'st.loadingLex': { ky: 'Сөздүк жүктөлүүдө…', ru: 'Загрузка словаря…', en: 'Loading word list…' },
    'st.ready': { ky: 'Даяр', ru: 'Готово', en: 'Ready' },
    'st.readyNoLex': { ky: 'Даяр (сөздүксүз)', ru: 'Готово (без словаря)', en: 'Ready (no word list)' },
    'st.error': { ky: (m) => `Ката: ${m}`, ru: (m) => `Ошибка: ${m}`, en: (m) => `Error: ${m}` },
    'st.modelFail': { ky: (m) => `Моделди жүктөө мүмкүн болгон жок: ${m}`, ru: (m) => `Не удалось загрузить модель: ${m}`,
      en: (m) => `Could not load the model: ${m}` },
    'alts': { ky: (t, p) => `${t} · ${p}%`, ru: (t, p) => `${t} · ${p}%`, en: (t, p) => `${t} · ${p}%` },

    // ---- index.html --------------------------------------------------------------------------
    'title.index': { ky: 'Кыргызча кол жазма таануу', ru: 'Распознавание кыргызского рукописного текста', en: 'Kyrgyz handwriting recognition' },
    'tab.draw': { ky: '✍️ Жазуу', ru: '✍️ Написать', en: '✍️ Draw' },
    'tab.photo': { ky: '📷 Сүрөт', ru: '📷 Фото', en: '📷 Photo' },
    'brush': { ky: 'Калем:', ru: 'Перо:', en: 'Brush:' },
    'brush.pen': { ky: 'Калем', ru: 'Ручка', en: 'Pen' },
    'brush.brush': { ky: 'Кисть', ru: 'Кисть', en: 'Brush' },
    'brush.ink': { ky: 'Сыя', ru: 'Чернила', en: 'Ink' },
    'idx.drawHint': { ky: 'Бир кыргызча сөз жазыңыз. Калемди көтөргөндөн кийин таануу өзү башталат.',
      ru: 'Напишите одно кыргызское слово. Распознавание начнётся само, когда вы поднимете перо.',
      en: 'Write one Kyrgyz word. Recognition runs automatically after you lift the pen.' },
    'idx.photoHint': { ky: 'Бир кол жазма сөздү сүрөткө тартыңыз. Сөздү белгилөө үчүн сүрөттүн үстүнөн сүйрөңүз (милдеттүү эмес).',
      ru: 'Сфотографируйте одно рукописное слово. Чтобы выделить слово, проведите по изображению (необязательно).',
      en: 'Photograph one handwritten word. Drag on the image to crop to the word (optional).' },
    'idx.examples': { ky: 'Мисалдар', ru: 'Примеры', en: 'Examples' },
    'idx.examplesHint': { ky: '— таануу үчүн сүрөттү басыңыз', ru: '— нажмите на фото, чтобы распознать', en: '— click a photo to recognise it' },
    'idx.examplesFail': { ky: 'Мисалдарды жүктөө мүмкүн болгон жок.', ru: 'Не удалось загрузить примеры.', en: 'Examples could not be loaded.' },
    'idx.modeOn': { ky: 'варианттар 100 миң сөздөн турган кыргызча корпус менен кайра бааланат',
      ru: 'варианты переоцениваются по кыргызскому корпусу из 100 тыс. слов',
      en: 'candidates are re-scored with a 100k-word Kyrgyz corpus' },
    'idx.modeOff': { ky: 'моделдин өз окуганы: тамга алмаштыруусуз жана корпустагы сөздөрсүз',
      ru: 'собственное чтение модели: без замены букв и без слов из корпуса',
      en: "the model's own reading: no letter substitution, no corpus words" },
    'idx.modelInput': { ky: 'Моделдин кириши:', ru: 'Вход модели:', en: 'Model input:' },
    'idx.noInk': { ky: 'Сыя табылган жок — сөз жазыңыз же белгилеңиз.', ru: 'Чернила не найдены — напишите или выделите слово.',
      en: 'No ink found — write or crop a word.' },
    'idx.expected': { ky: 'Күтүлгөн:', ru: 'Ожидалось:', en: 'Expected:' },
    'idx.best': { ky: (p) => `Эң ыктымал жооп ${p}%`, ru: (p) => `Лучший вариант ${p}%`, en: (p) => `Best guess ${p}%` },
    'idx.withLex': { ky: 'сөздүк менен оңдолду', ru: 'с исправлением по словарю', en: 'with word-list correction' },
    'idx.lexLoading': { ky: 'модель гана (сөздүк дагы жүктөлүүдө)', ru: 'только модель (словарь ещё загружается)',
      en: 'model only (word list still loading)' },
    'idx.noLex': { ky: 'модель гана, сөздүксүз', ru: 'только модель, без словаря', en: 'model only, no word list' },
    'idx.about': {
      ky: '<b>Долбоор жөнүндө.</b> «Кыргызча кол жазма сөздөр» маалымат топтомунда (v1.1) үйрөтүлгөн CNN-BiLSTM CTC таануучу толугу менен браузериңизде иштейт (onnxruntime-web); анын варианттарын 100 миң сөздөн турган кыргызча сөз тизмеси кайра баалайт. Бул жерде жазган же жүктөгөн эч нерсе түзмөгүңүздөн чыкпайт.',
      ru: '<b>О проекте.</b> Распознаватель CNN-BiLSTM CTC, обученный на наборе данных «Кыргызские рукописные слова» (v1.1), работает полностью в вашем браузере (onnxruntime-web); его варианты переоцениваются по кыргызскому списку из 100 тыс. слов. Ничего из написанного или загруженного здесь не покидает ваше устройство.',
      en: '<b>About.</b> A CNN-BiLSTM CTC recogniser trained on the Kyrgyz Handwritten Words dataset (v1.1) runs entirely in your browser (onnxruntime-web); a 100k-word Kyrgyz word list re-scores its candidates. Nothing you write or upload here leaves your device.' },
    'idx.accLabel': { ky: 'Маалымат топтомунун тест бөлүгүндө күтүлгөн тактык:', ru: 'Ожидаемая точность на тестовой части набора данных:',
      en: "Expected accuracy on the dataset's test split:" },
    'idx.acc': { ky: (w, c) => `сөздөрдүн ≈ ${w} % туура, тамга катасы ${c} %`, ru: (w, c) => `≈ ${w} % слов верно, ${c} % ошибок в символах`,
      en: (w, c) => `≈ ${w} % of words, ${c} % character error` },
    'idx.footer': {
      ky: 'Маалымат топтому: Бурул Шамбетова (ORCID 0009-0001-5149-3744) жана студенттер. Корпус: Leipzig Corpora Collection, Manas-UdS Kyrgyz Corpus, Kyrgyz News Corpus.',
      ru: 'Набор данных: Бурул Шамбетова (ORCID 0009-0001-5149-3744) и студенты. Корпус: Leipzig Corpora Collection, Manas-UdS Kyrgyz Corpus, Kyrgyz News Corpus.',
      en: 'Dataset: Burul Shambetova (ORCID 0009-0001-5149-3744) and students. Corpus: Leipzig Corpora Collection, Manas-UdS Kyrgyz Corpus, Kyrgyz News Corpus.' },

    // ---- page.html ---------------------------------------------------------------------------
    'title.page': { ky: 'Барак / текст таануу', ru: 'Распознавание страницы', en: 'Full-page recognition' },
    'tab.pagePhoto': { ky: '📷 Барактын сүрөтү', ru: '📷 Фото страницы', en: '📷 Photo of a page' },
    'tab.sentence': { ky: '✍️ Сүйлөм жазуу', ru: '✍️ Написать предложение', en: '✍️ Write a sentence' },
    'pg.photoHint': {
      ky: 'Кол менен жазылган барактын же бир нече саптын сүрөтү же сканы. Ак кагаздагы кара сыя, сүрөттүн көбүн ээлеген барак жана болжол менен түз саптар эң жакшы натыйжа берет (кичине кыйшаюу оңдолот).',
      ru: 'Фото или скан рукописной страницы или нескольких строк. Лучше всего работает с тёмными чернилами на чистой бумаге, когда страница занимает большую часть снимка, а строки примерно горизонтальны (небольшой наклон исправляется).',
      en: 'A photo or scan of a handwritten page or a few lines. Works best with dark ink on plain paper, the page filling most of the photo and lines roughly horizontal (small tilts are corrected).' },
    'pg.drawHint': { ky: 'Бир же бир нече сап жазыңыз, сөздөрдүн ортосуна ачык боштук калтырыңыз.',
      ru: 'Напишите одну или несколько строк, оставляя между словами заметные пробелы.',
      en: 'Write one or more lines, leaving a clear space between words.' },
    'pg.text': { ky: 'Текст', ru: 'Текст', en: 'Text' },
    'pg.copy': { ky: 'Көчүрүү', ru: 'Копировать', en: 'Copy' },
    'pg.clickHint': { ky: 'Ал сөздүн башка варианттарын көрүү үчүн сүрөттөгү алкакты басыңыз.',
      ru: 'Нажмите на рамку на изображении, чтобы увидеть варианты для этого слова.',
      en: 'Click a box on the image to see the alternatives for that word.' },
    'pg.how': {
      ky: '<b>Кантип иштейт.</b> Барак түздөлөт, сызыктар жана тактар алынып салынат, саптар барак боюнча изделет (алар ийри болушу мүмкүн), ар бир сап кең боштуктар боюнча сөздөргө бөлүнөт. Андан кийин ар бир сөздү сөз барагындагы эле таануучу окуйт. Сүрөткө тартылган дилбаян барактарында сөздөрдүн болжол менен 23 % жана тамгалардын 6 % ката окулат; негизги каталар бири-бирине тийген же кийинки сапка кирип кеткен сөздөрдөн келет. Баары браузериңизде иштейт; сүрөт эч жакка жүктөлбөйт.',
      ru: '<b>Как это работает.</b> Страница выравнивается, линовка и пятна удаляются, строки прослеживаются по всей странице (они могут изгибаться), и каждая строка делится на слова по широким промежуткам. Затем каждое слово читает тот же распознаватель, что и на странице слов. На сфотографированных страницах сочинений это даёт около 23 % ошибок в словах и 6 % в символах; основной источник ошибок — слова, которые касаются друг друга или заходят на соседнюю строку. Всё работает в вашем браузере; изображение никуда не загружается.',
      en: '<b>How it works.</b> The page is straightened, ruled lines and specks are removed, text lines are traced across the page (they may curve), and each line is split into words at the wide gaps. Every word is then read by the same recogniser as on the word page. On photographed essay pages this gives about 23 % word errors and 6 % character errors; words that touch or run into the next line are the main source of mistakes. Everything runs in your browser; the image is not uploaded.' },
    'pg.nothing': { ky: 'Азырынча эч нерсе жазылган жок.', ru: 'Пока ничего не написано.', en: 'Nothing written yet.' },
    'pg.finding': { ky: 'Саптар жана сөздөр изделүүдө…', ru: 'Поиск строк и слов…', en: 'Finding lines and words…' },
    'pg.noLines': { ky: 'Текст саптары табылган жок. Жакыныраак, тагыраак, кара сыя менен жазылган сүрөттү колдонуп көрүңүз.',
      ru: 'Строки текста не найдены. Попробуйте более близкое и чёткое фото с тёмными чернилами.',
      en: 'No text lines found. Try a closer, sharper photo with dark ink.' },
    'pg.reading': { ky: (i, n) => `Сөздөр окулууда ${i} / ${n}…`, ru: (i, n) => `Чтение слов ${i} / ${n}…`, en: (i, n) => `Reading words ${i} / ${n}…` },
    'pg.done': {
      ky: (l, w, a, ts, tr) => `${l} сап, ${w} сөз · ${a}° түздөлдү · бөлүү ${ts} мс, окуу ${tr} мс`,
      ru: (l, w, a, ts, tr) => `${l} строк, ${w} слов · выравнивание ${a}° · сегментация ${ts} мс, чтение ${tr} мс`,
      en: (l, w, a, ts, tr) => `${l} lines, ${w} words · straightened ${a}° · segmentation ${ts} ms, reading ${tr} ms` },
    'pg.noLexSuffix': { ky: ' · модель гана, сөздүксүз', ru: ' · только модель, без словаря', en: ' · model only, no word list' },

    // ---- collect.html ------------------------------------------------------------------------
    'title.collect': { ky: 'Кол жазма чогултуу', ru: 'Сбор почерка', en: 'Handwriting collection' },
    'dev.question': { ky: 'Эмне менен жазасыз?', ru: 'Чем вы будете писать?', en: 'What will you write with?' },
    'dev.required': { ky: '(милдеттүү; кийин өзгөртсө болот)', ru: '(обязательно; можно изменить позже)', en: '(required; can be changed later)' },
    'dev.short': { ky: 'Жазуу куралы:', ru: 'Пишу:', en: 'Writing with:' },
    'dev.finger': { ky: 'Манжа', ru: 'Палец', en: 'Finger' },
    'dev.mouse': { ky: 'Чычкан', ru: 'Мышь', en: 'Mouse' },
    'dev.touchpad': { ky: 'Тачпад (сенсордук панель)', ru: 'Тачпад', en: 'Touchpad' },
    'dev.stylus': { ky: 'Стилус', ru: 'Стилус', en: 'Stylus' },
    'col.right': { ky: 'оң', ru: 'правая', en: 'right' },
    'col.left': { ky: 'сол', ru: 'левая', en: 'left' },
    'col.kyrgyz': { ky: 'кыргыз тили', ru: 'кыргызский', en: 'Kyrgyz' },
    'col.russian': { ky: 'орус тили', ru: 'русский', en: 'Russian' },
    'col.other': { ky: 'башка', ru: 'другой', en: 'other' },
    'col.allDone': { ky: 'Бүттү — рахмат!', ru: 'Готово — спасибо!', en: 'All done — thank you!' },
    'col.footer': { ky: 'Рахмат! Ачык кыргыз тил технологияларына салым кошконуңуз үчүн ыраазыбыз.',
      ru: 'Спасибо за вклад в открытые технологии кыргызского языка!',
      en: 'Thank you for contributing to open Kyrgyz language technology.' },
    'col.shortOnly': { ky: 'Телефондо кыска сөздөр гана сунушталат.', ru: 'На телефоне предлагаются только короткие слова.',
      en: 'On a phone only short words are suggested.' },

    // ---- validate.html -----------------------------------------------------------------------
    'title.validate': { ky: 'Текшерүү', ru: 'Проверка', en: 'Validation' },
    'val.h2': { ky: 'Чогултулган кол жазманы текшерүү', ru: 'Проверка собранного почерка', en: 'Validate collected handwriting' },
    'val.intro': {
      ky: 'Ар бир сүрөттө белгидеги сөз жазылганын текшериңиз. Google аккаунту бар ар ким жардам бере алат. Ар бир үлгүгө бири-биринен көз карандысыз, бирдей жок дегенде эки добуш керек; адегенде экинчи добушту күткөн үлгүлөр, андан кийин таануучу жазуучунун белгисине макул болбогон үлгүлөр көрсөтүлөт.',
      ru: 'Проверьте, что на каждом изображении написано слово из подписи. Помочь может любой, у кого есть аккаунт Google. Каждому образцу нужно не менее двух независимых совпадающих голосов; сначала показываются образцы, ждущие второго голоса, затем те, где распознаватель не согласен с подписью автора.',
      en: "Check that each image shows the word in its label. Anyone with a Google account can help. Each sample needs at least two independent votes that agree; samples waiting for a second vote come first, then those where the recogniser disagrees with the writer's label." },
    'val.once': { ky: 'Бир жолу гана киресиз; кийинки жолу иш түз эле уланат. Өзүңүздүн кол жазмаңыз сизге көрсөтүлбөйт.',
      ru: 'Вход нужен один раз; при следующих посещениях работа продолжается сразу. Ваш собственный почерк вам не показывается.',
      en: 'You sign in once; the next visits continue directly. You will not be shown your own writing.' },
    'val.thanks': { ky: 'Рахмат — кезегиңиз бош.', ru: 'Спасибо — ваша очередь пуста.', en: 'Thank you — your queue is empty.' },
    'val.recheck': { ky: '↻ Жаңы үлгүлөрдү текшерүү', ru: '↻ Проверить новые образцы', en: '↻ Check for new samples' },
    'val.image': { ky: 'Сүрөт', ru: 'Изображение', en: 'Image' },
    'val.replay': { ky: 'Жазылышын кайталоо', ru: 'Повтор штрихов', en: 'Stroke replay' },
    'val.prompt': { ky: 'Тапшырма', ru: 'Задание', en: 'Prompt' },
    'val.label': { ky: 'Белги (жазылган)', ru: 'Подпись (написано)', en: 'Label (written)' },
    'val.model': { ky: 'Модель окуду', ru: 'Модель прочитала', en: 'Model read' },
    'val.brush': { ky: 'Калем / киргизүү', ru: 'Перо / ввод', en: 'Brush / input' },
    'val.votes': { ky: 'Добуштар', ru: 'Голоса', en: 'Votes' },
    'v.correct': { ky: '1 ✓ Туура', ru: '1 ✓ Верно', en: '1 ✓ Correct' },
    'v.wrong': { ky: '2 ✎ Белги туура эмес', ru: '2 ✎ Неверная подпись', en: '2 ✎ Wrong label' },
    'v.illegible': { ky: '3 Окулбайт', ru: '3 Неразборчиво', en: '3 Illegible' },
    'v.notky': { ky: '4 Кыргызча эмес / чийме', ru: '4 Не по-кыргызски / каракули', en: '4 Not Kyrgyz / scribble' },
    'v.pii': { ky: '5 Жеке маалымат', ru: '5 Личная информация', en: '5 Personal information' },
    'v.skip': { ky: 'S Өткөрүү', ru: 'S Пропустить', en: 'S Skip' },
    'val.fixLabel': { ky: 'Туура текст', ru: 'Правильный текст', en: 'Correct text' },
    'val.fixSave': { ky: 'Сактоо (Enter)', ru: 'Сохранить (Enter)', en: 'Save (Enter)' },
    'val.keys': {
      ky: 'Баскычтар: 1 туура · 2 белги туура эмес · 3 окулбайт · 4 кыргызча эмес · 5 жеке маалымат · S өткөрүү · Enter оңдоону сактоо',
      ru: 'Клавиши: 1 верно · 2 неверная подпись · 3 неразборчиво · 4 не по-кыргызски · 5 личная информация · S пропустить · Enter сохранить исправление',
      en: 'Keys: 1 correct · 2 wrong label · 3 illegible · 4 not Kyrgyz · 5 personal info · S skip · Enter save correction' },
    'val.noConfig': { ky: 'Firebase долбоору туташтырылган эмес.', ru: 'Проект Firebase не настроен.', en: 'No Firebase project configured.' },
    'val.loading': { ky: 'Үлгүлөр жүктөлүүдө…', ru: 'Загрузка образцов…', en: 'Loading samples…' },
    'val.progress': { ky: (d, n) => `${d} текшерилди · кезекте ${n}`, ru: (d, n) => `${d} проверено · в очереди ${n}`,
      en: (d, n) => `${d} reviewed · ${n} in queue` },
    'val.emptyInfo': {
      ky: (s, o, v, d) => `Сиз текшере турган үлгү калган жок. ${s} үлгүнүн ${o} өзүңүздүкү (өз кол жазмаңызды текшерүүгө болбойт), ${v} үлгүгө добуш бергенсиз, ${d} үлгү эки бирдей добуш менен чечилген. Башка адамдар жазган үлгүлөр бул жерде пайда болот.`,
      ru: (s, o, v, d) => `Для вас не осталось образцов. Из ${s} образцов ${o} — ваши собственные (свой почерк проверять нельзя), за ${v} вы уже голосовали, ${d} уже решены двумя совпадающими голосами. Здесь появятся образцы, написанные другими людьми.`,
      en: (s, o, v, d) => `Nothing left for you to validate. Of ${s} samples, ${o} are your own (nobody validates their own writing), ${v} already have your vote and ${d} are already decided by two agreeing votes. Samples written by other people will appear here.` },
    'val.votesN': { ky: (n) => `Мурун ${n} добуш берилген (жок дегенде 2 бирдей добуш керек)`,
      ru: (n) => `Уже голосов: ${n} (нужно не менее 2 совпадающих)`,
      en: (n) => `${n} other vote${n > 1 ? 's' : ''} so far (at least 2 agreeing needed)` },
    'val.votes0': { ky: 'Биринчи добуш (жок дегенде 2 бирдей добуш керек)', ru: 'Первый голос (нужно не менее 2 совпадающих)',
      en: 'first vote (at least 2 agreeing needed)' },
    'val.eq': { ky: '= белги', ru: '= подпись', en: '= label' },
    'val.neq': { ky: '≠ белги', ru: '≠ подпись', en: '≠ label' },
    'val.enterText': { ky: 'Туура текстти киргизиңиз.', ru: 'Введите правильный текст.', en: 'Enter the correct text.' },
    'val.saveFail': { ky: (m) => `Сакталган жок: ${m}`, ru: (m) => `Не удалось сохранить: ${m}`, en: (m) => `Could not save: ${m}` },
    'val.signinFail': { ky: (m) => `Кирүү ишке ашкан жок: ${m}`, ru: (m) => `Не удалось войти: ${m}`, en: (m) => `Sign-in failed: ${m}` },

    // ---- admin.html --------------------------------------------------------------------------
    'title.admin': { ky: 'Рейтинг (админ)', ru: 'Рейтинг (админ)', en: 'Ranking (admin)' },
    'adm.h2': { ky: 'Админ панели', ru: 'Панель администратора', en: 'Admin dashboard' },
    'adm.intro': {
      ky: 'Катышуучулардын жана текшерүүчүлөрдүн рейтинги. Бул баракты Firestore\'догу <code>admins</code> жыйнагында электрондук почтасы көрсөтүлгөн Google аккаунттары гана ача алат.',
      ru: 'Рейтинги участников и проверяющих. Открыть страницу могут только аккаунты Google, чьи адреса указаны в коллекции Firestore <code>admins</code>.',
      en: 'Rankings of contributors and validators. Only Google accounts listed by e-mail in the Firestore collection <code>admins</code> can open it.' },
    'adm.period': { ky: 'Мезгил', ru: 'Период', en: 'Period' },
    'adm.all': { ky: 'бардык убакыт', ru: 'за всё время', en: 'all time' },
    'adm.d30': { ky: 'акыркы 30 күн', ru: 'последние 30 дней', en: 'last 30 days' },
    'adm.d7': { ky: 'акыркы 7 күн', ru: 'последние 7 дней', en: 'last 7 days' },
    'adm.d1': { ky: 'акыркы 24 саат', ru: 'последние 24 часа', en: 'last 24 hours' },
    'adm.reload': { ky: '↻ Жаңылоо', ru: '↻ Обновить', en: '↻ Reload' },
    'adm.contributors': { ky: 'Катышуучулар', ru: 'Участники', en: 'Contributors' },
    'adm.contribNote': {
      ky: 'Кабыл алынган үлгүлөр боюнча иреттелген (≥ 2 бирдей добуш). Кабыл алуу = кабыл алынган / (кабыл алынган + четке кагылган). Иреттөө үчүн тилкени басыңыз.',
      ru: 'Отсортировано по принятым образцам (≥ 2 совпадающих голоса). Доля принятых = принятые / (принятые + отклонённые). Нажмите на столбец для сортировки.',
      en: 'Ranked by accepted samples (≥ 2 agreeing votes). Acceptance = accepted / (accepted + rejected). Click a column to sort.' },
    'adm.validators': { ky: 'Текшерүүчүлөр', ru: 'Проверяющие', en: 'Validators' },
    'adm.valNote': {
      ky: 'Добуштар саны боюнча иреттелген. Макулдук = чечилген үлгүлөрдүн ичинен акыркы чечимге дал келген добуштар.',
      ru: 'Отсортировано по числу голосов. Согласие = доля голосов, совпавших с итоговым решением, среди решённых образцов.',
      en: 'Ranked by votes. Agreement = votes matching the final decision, among decided samples.' },
    'adm.footer': {
      ky: 'Бул барактагы аттар жана электрондук даректер жеке маалымат: аларды башкаларга бербеңиз жана жарыялабаңыз.',
      ru: 'Имена и адреса электронной почты на этой странице — персональные данные: не передавайте и не публикуйте их.',
      en: 'Names and e-mail addresses on this page are personal data: do not share or publish them.' },
    'adm.notAdmin': {
      ky: (e) => `<b>${e}</b> катары кирдиңиз, бул аккаунт админ эмес. Учурдагы админ ушул электрондук почтаны ID катары колдонуп, Firestore'догу <code>admins</code> жыйнагына документ кошот.`,
      ru: (e) => `Вы вошли как <b>${e}</b>, этот аккаунт не является администратором. Действующий администратор добавляет документ с этим адресом в качестве ID в коллекцию Firestore <code>admins</code>.`,
      en: (e) => `Signed in as <b>${e}</b>, which is not an admin. An existing admin adds a document with this e-mail as its ID to the Firestore collection <code>admins</code>.` },
    'adm.who': { ky: (e) => `${e} катары кирдиңиз`, ru: (e) => `Вы вошли как ${e}`, en: (e) => `Signed in as ${e}` },
    'adm.loadingN': { ky: (n) => `Үлгүлөр жүктөлүүдө… ${n}`, ru: (n) => `Загрузка образцов… ${n}`, en: (n) => `Loading samples… ${n}` },
    'adm.loaded': {
      ky: (s, v, p, w) => `${s} үлгү, ${v} добуш, ${p} профиль жүктөлдү · ${w}`,
      ru: (s, v, p, w) => `Загружено: ${s} образцов, ${v} голосов, ${p} профилей · ${w}`,
      en: (s, v, p, w) => `${s} samples, ${v} votes, ${p} profiles loaded · ${w}` },
    'adm.noData': { ky: 'Бул мезгилде маалымат жок.', ru: 'Нет данных за этот период.', en: 'No data for this period.' },
    'c.name': { ky: 'Аты', ru: 'Имя', en: 'Name' },
    'c.email': { ky: 'Эл. почта', ru: 'Эл. почта', en: 'E-mail' },
    'c.accepted': { ky: 'Кабыл алынды', ru: 'Принято', en: 'Accepted' },
    'c.samples': { ky: 'Үлгүлөр', ru: 'Образцы', en: 'Samples' },
    'c.rejected': { ky: 'Четке кагылды', ru: 'Отклонено', en: 'Rejected' },
    'c.open': { ky: 'Добуш күтүүдө', ru: 'Ждут голосов', en: 'Awaiting votes' },
    'c.pii': { ky: 'Жеке маал.', ru: 'Личн. данные', en: 'PII' },
    'c.excluded': { ky: 'Чыгарылды (жеке маал.)', ru: 'Исключено (личн. данные)', en: 'Excluded (PII)' },
    'c.acceptance': { ky: 'Кабыл алуу', ru: 'Доля принятых', en: 'Acceptance' },
    'c.words': { ky: 'Ар башка сөздөр', ru: 'Разных слов', en: 'Distinct words' },
    'c.last': { ky: 'Акыркы активдүүлүк', ru: 'Последняя активность', en: 'Last active' },
    'c.votes': { ky: 'Добуштар', ru: 'Голоса', en: 'Votes' },
    'c.decided': { ky: 'Чечилген үлгүлөрдө', ru: 'По решённым образцам', en: 'On decided samples' },
    'c.agreement': { ky: 'Макулдук', ru: 'Согласие', en: 'Agreement' },
    'c.corrections': { ky: 'Оңдоолор', ru: 'Исправления', en: 'Corrections' },
    'c.lastVote': { ky: 'Акыркы добуш', ru: 'Последний голос', en: 'Last vote' },
    'c.contributors': { ky: 'Катышуучулар', ru: 'Участники', en: 'Contributors' },
    'c.validators': { ky: 'Текшерүүчүлөр', ru: 'Проверяющие', en: 'Validators' },
  };

  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
  };

  function detect() {
    const url = new URLSearchParams(location.search).get('lang');
    if (LANGS[url]) return url;
    const saved = store.get();
    if (LANGS[saved]) return saved;
    for (const l of navigator.languages || [navigator.language || '']) {
      const p = String(l).toLowerCase().slice(0, 2);
      if (LANGS[p]) return p;
    }
    return 'en';
  }

  let lang = detect();

  function t(key, ...a) {
    const e = D[key];
    if (!e) return key;
    const v = e[lang] !== undefined ? e[lang] : e.en;
    return typeof v === 'function' ? v(...a) : v;
  }

  function apply(scope = document) {
    const html = document.documentElement;
    html.dataset.ui = lang;
    html.lang = lang;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    if (html.dataset.title) document.title = `${t(html.dataset.title)} · Kyrgyz HTR`;
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = lang;
  }

  function setLang(l, remember = true) {
    if (!LANGS[l]) return;
    lang = l;
    if (remember) store.set(l);
    apply();
    root.dispatchEvent(new CustomEvent('khtr:lang', { detail: l }));
  }

  /* language dropdown in the page header */
  function mount() {
    const wrap = document.querySelector('header .wrap');
    if (!wrap || document.getElementById('lang-select')) return;
    const label = document.createElement('label');
    label.className = 'lang-pick';
    const sel = document.createElement('select');
    sel.id = 'lang-select';
    sel.setAttribute('aria-label', 'Тил / Язык / Language');
    for (const [k, name] of Object.entries(LANGS)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = name;
      sel.appendChild(o);
    }
    sel.onchange = () => setLang(sel.value);
    label.append('🌐 ', sel);
    wrap.appendChild(label);
  }

  document.documentElement.dataset.ui = lang;
  document.documentElement.lang = lang;
  // loaded at the end of <body>, before the page scripts: the DOM above is ready
  mount();
  apply();

  root.KHTR = Object.assign(root.KHTR || {}, { t, setLang, lang: () => lang, LANGS });
})(typeof window !== 'undefined' ? window : globalThis);
