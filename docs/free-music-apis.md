# Бесплатные музыкальные API и парсеры

Проверено **6 октября 2026 года**. В репозитории появился инструмент поиска и экспорта свободной музыки: четыре адаптера, общий формат метаданных и проверка доступности аудиофайлов. Для этих четырёх источников API-ключ не нужен.

Для узнаваемых мелодий сейчас лучше всего подходят Kevin MacLeod, конкретные свободные записи Brad Sucks и классика. Большая независимая библиотека сама по себе не даёт знакомые хиты Drake, Eminem или The Weeknd. Бесплатный API с подтверждённым разрешением использовать массовый каталог этих оригинальных записей в публичной угадайке среди проверенных вариантов не найден.

## API: что реально доступно

| Источник | Бесплатный доступ | Для чего подходит | Состояние |
| --- | --- | --- | --- |
| [Incompetech](https://incompetech.com/music/royalty-free/licenses/) | Открытый JSON и страницы автора; бесплатно с атрибуцией | Мемные мелодии Kevin MacLeod, soundtrack, electronic, pop, rock и другие авторские жанры | Адаптер готов; JSON и выбранные MP3 проверены |
| [Wikimedia Commons](https://www.mediawiki.org/wiki/Extension:TimedMediaHandler/API) | Публичный MediaWiki API | Свободные фонограммы классики и отдельных независимых исполнителей | Адаптер готов; использует предоставленные сервисом MP3-транскоды |
| [ccMixter](https://ccmixter.org/query-api) | Публичный Query API | Авторские hip-hop, pop, rock, electronic, jazz; вокальные ремиксы и инструменталы | Поиск готов; выбранные прямые MP3 вернули 403 при проверке |
| [Openverse](https://docs.openverse.org/api/reference/authentication_and_throttling.html) | Анонимные запросы с ограничениями частоты | Поиск аудио по названию, автору и CC-лицензии | Адаптер готов; небольшие целевые запросы, без зеркалирования каталога |
| [Internet Archive](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html) | Публичные Search и Metadata API | Архивные/свободные записи с проверкой лицензии каждой фонограммы | Два запроса с этого компьютера завершились таймаутом; готового адаптера нет |
| [Jamendo](https://developer.jamendo.com/v3.0) | Бесплатный некоммерческий API; до 35 000 запросов/месяц по текущей странице сервиса | Большой независимый каталог, жанры, исполнители, плейлисты | Нужен собственный зарегистрированный client ID; адаптер не активирован |
| [Freesound](https://freesound.org/docs/api/) | Бесплатный некоммерческий API, нужен ключ приложения | Звуки, петли, отдельные музыкальные записи; дополнительный источник, а не библиотека поп-хитов | Условия и аутентификация проверены; адаптера нет |
| [MusicBrainz](https://musicbrainz.org/doc/Developer_Resources) | Публичный REST API метаданных | Исполнители, релизы, идентификаторы, уточнение дат | Реальный поиск вернул HTTP 200; аудио API не предоставляет |

[Условия Jamendo](https://devportal.jamendo.com/api_terms_of_use) отделяют некоммерческое использование от коммерческого, требуют отдельного client ID приложения и кредита автору/провайдеру. [Freesound](https://freesound.org/docs/api/terms_of_use.html) также ограничивает бесплатный API некоммерческими проектами. Эти ограничения относятся к сервису в дополнение к лицензии самого файла.

Openverse — поисковый индекс, а не владелец прав или аудиохостинг. Реализованный адаптер принимает только известные HTTPS-хосты Incompetech, ccMixter и Wikimedia; результаты с других хостов пропускаются. Учитывается лицензия результата, а перед включением записи в игру нужно сверить её с исходной страницей. Команда не обходит ограничения API и не выполняет массовую пагинацию Openverse.

## Запуск

Достаточно `bun install --frozen-lockfile`. PostgreSQL, Redis и переменные production для этой команды не требуются.

```powershell
bun run music:discover --help

bun run music:discover --source incompetech --query "Sneaky" --limit 5 --verify-audio --output .data/music-discovery/sneaky.json
bun run music:discover --source commons --query "File:Moonlight.ogg" --verify-audio --output .data/music-discovery/moonlight.json
bun run music:discover --source commons --query "File:01 - Brad Sucks - Dropping out of School.ogg" --verify-audio --output .data/music-discovery/brad-sucks.json
bun run music:discover --source ccmixter --query "hip_hop" --limit 5 --verify-audio --output .data/music-discovery/hip-hop.json
bun run music:discover --source openverse --query "Monkeys Spinning Monkeys" --limit 5 --verify-audio --output .data/music-discovery/monkeys.json

# Один запрос к каждому источнику, общий экспорт и удаление дублей аудиофайла:
bun run music:discover --source all --query "Monkeys Spinning Monkeys" --limit 5 --output .data/music-discovery/combined.json

# Жанры автора или теги ccMixter:
bun run music:discover --source incompetech --query "Pop" --output .data/music-discovery/pop.json
bun run music:discover --source ccmixter --query "rock" --limit 10 --output .data/music-discovery/rock.json
```

`--limit` задаёт число результатов **на источник**, от 1 до 50; у Openverse максимум 20. Commons и Openverse требуют непустой целевой запрос. Incompetech можно вызвать без запроса для первых записей авторского каталога; ccMixter — для подборки по рейтингу сервиса. `--source all` возвращает результаты успешных источников даже при ошибке другого.

`--non-commercial` дополнительно допускает CC BY-NC и BY-NC-SA. Это отметка условий для кандидатов, а не способ разрешить коммерческое использование этих записей. По умолчанию принимаются распознанные CC BY, BY-SA, CC0 и Public Domain Mark. ND, неизвестные лицензии, дополнительные ограничения Commons, неподходящие хосты и записи короче 16 секунд исключаются. Public Domain Mark является заявлением о статусе записи, которое нужно проверить на исходной странице.

Экспорт записывается только в JSON-файл внутри `.data/`, которая исключена из Git. Содержимое ранее выбранного файла заменяется. Код завершения: 0 — запросы завершены; 1 — неверные аргументы или ошибка всех источников; 2 — часть источников недоступна; 3 — хотя бы одна запрошенная аудиопроверка не прошла. Пустой успешный поиск имеет код 0; проверяйте число выбранных записей.

## Что сохраняется

Каждый кандидат содержит `id`, `source`, `title`, `artist`, `durationSec`, `genreTags`, `publishedAt`, `releaseYear`, `audioUrl`, `audioMime`, `sourceUrl`, точный код/версию/URL лицензии, готовую строку `attribution`, `playerCompatible` и результат `audioProbe` при проверке.

Incompetech предоставляет официальный [JSON-каталог](https://incompetech.com/music/royalty-free/pieces.json). Парсер читает статическую таблицу жанров с [авторской страницы](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011) как JSON; чужой JavaScript не запускается. ccMixter сохраняет соавторов из `featuring` и только присутствующие в метаданных жанровые теги. Commons сохраняет кредит исполнителю записи вместе с композитором. Жанры у Commons/Openverse остаются пустыми, если API не дал проверяемых данных.

**Дата публикации файла не превращается в год релиза.** `releaseYear` остаётся `null`; такие кандидаты нельзя автоматически записывать в пакет «популярные 2010-е». Название композиции также не доказывает, что это оригинал известного исполнителя. Разные записи и кодировки могут иметь одинаковые названия: дедупликация удаляет одинаковые аудиоссылки, но не объединяет все результаты по названию.

`playerCompatible` означает, что файл уже имеет формат MPEG для текущего игрового обрезчика. Доступный OGG сохраняется как кандидат с отдельной отметкой совместимости. Проверка ограничена первыми **64 KiB** файла и его сигнатурой/MIME, включая серверы, игнорирующие Range. Это проверка доступности, не прослушивание всей записи и не автоматическая проверка правообладания. Метаданные ограничены 2 MB, запросы — таймаутом 15 секунд. Аудиопроверки идут последовательно с секундным интервалом. При HTTP 429 сохраняется `Retry-After`; автоматических повторов нет.

## Реальные результаты проверки

| Запрос | Получено метаданных | Подошло | Выбрано | Проверка аудиоссылок |
| --- | ---: | ---: | ---: | --- |
| Incompetech: `Sneaky` | 1 443 | 1 433 во всём каталоге | 3 по запросу | 3/3 доступны: Sneaky Snitch, Sneaky, Sneaky Adventure |
| Commons: `File:Moonlight.ogg` | 1 | 1 | 1 | 1/1, готовый MP3, HTTP 206 |
| Commons: `Beethoven` | 5 | 1 | 1 | 1/1, запись Prometheus Creatures |
| Commons: файл Brad Sucks | 1 | 1 | 1 | 1/1, Dropping out of School, CC BY-SA 3.0 |
| Openverse: `Monkeys Spinning Monkeys` | 4 | 4 | 4 | 4/4; четыре файла/версии одной композиции, не четыре разные песни |
| ccMixter: `hip_hop` | 5 | 4 | 4 | 0/4; все выбранные MP3 вернули HTTP 403 |

Общий запуск `--source all --query "Monkeys Spinning Monkeys" --limit 5` также завершился успешно: четыре источника ответили, сохранены восемь уникальных аудиоссылок после удаления одного дубликата. Это несколько файлов/версий одной композиции; дополнительная аудиопроверка в этом запуске не запрашивалась.

У ccMixter исходная страница `I dunno` вернула HTTP 200, а URL аудио из API — HTTP 403 с телом `Forbidden`. Причина отказа сервера не установлена. Проверка сохраняет недоступность; ограничения не обходятся. Результаты остальных источников пригодны для дальнейшего отбора.

**1 433 — число кандидатов с подходящими метаданными Incompetech, а не число полностью прослушанных или импортированных песен.** Локальные отчёты находятся в `.data/music-discovery/`. Сам экспорт содержит `activatedInGame: false`: текущая команда не меняет PostgreSQL, пакеты или каталог на Vercel.

## Другие бесплатные каталоги для выбранных страниц

Это варианты для дополнительного отбора; готовые массовые парсеры для них не заявлены. Проверка конкретных бесплатных фонограмм остаётся необходимой.

| Каталог | Музыка и условия |
| --- | --- |
| [Newgrounds Audio](https://www.newgrounds.com/audio/) | Игровая электроника, Geometry Dash, dubstep, chiptune. Условия указаны отдельно для каждой записи. Прямой запрос страницы во время проверки завершился таймаутом. |
| [Jonathan Coulton](https://www.jonathancoulton.com/faq/) | Авторские Code Monkey, Re: Your Brains и другие песни; некоммерческое использование с кредитом, исключения для чужого материала. |
| [Josh Woodward](https://www.joshwoodward.com/song/Rebound) | Акустические и вокальные песни; у Rebound CC BY 4.0. Прямые запросы сайта ранее возвращали 403. |
| [Scott Buckley](https://www.scottbuckley.com.au/library/licensing/) | Оркестровая библиотека CC BY 4.0 с атрибуцией; исключения для ремиксов чужих тем. |
| [Chris Zabriskie](https://chriszabriskie.com/use/) | Ambient и минимализм, CC BY 4.0. |
| [Audionautix](https://audionautix.com/) | Авторские rock, hip-hop, pop/funk, house, jazz; CC BY 4.0. |
| [OpenGameArt](https://opengameart.org/) | Игровая музыка, отдельные наборы CC0/CC BY; лицензия конкретной записи. |
| [Free Music Archive](https://freemusicarchive.org/License_Guide) | Независимые исполнители; разные лицензии, не единое разрешение на весь каталог. |
| [Musopen](https://musopen.org/signup/) | Классика; бесплатный план с пятью загрузками в день, права проверяются на конкретную фонограмму. |
| [Nine Inch Nails — CC-релизы](https://creativecommons.org/2008/05/05/another-nine-inch-nails-album-out-under-a-creative-commons-license/) | The Slip и Ghosts I–IV — конкретные CC BY-NC-SA релизы; не весь каталог группы, текущие ссылки загрузки не проверены. |

У NCS и TheFatRat бесплатные условия для видео не означают готовое разрешение на нашу публичную игру. Каталоги без явного разрешения на выбранную запись и страницы с блокировкой доступа не обходятся парсером.

## Проверка кода

```powershell
bun test tests/music-discovery.test.ts
bun run typecheck
bun run lint
```

21 тест проверяет лицензии, атрибуцию, даты, длительность, жанры, производные MP3, некорректные данные, ограничения URL/размера, перенаправления, HTTP 429, дедупликацию и сохранение частичных результатов. Typecheck завершился без ошибок; полный lint — без ошибок, с одним существующим предупреждением в игнорируемом локальном QA-скрипте `.data/production-deployment/verify-public.mjs`.
