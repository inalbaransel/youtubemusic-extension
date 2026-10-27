# About Baransel İnal

- Full name: Baransel İnal. Computer Engineering student at Istanbul Nişantaşı University. Lives in Istanbul, Türkiye.
- Has been building web and mobile applications for over 3 years.
- Started on the UI/UX side: turned his own Figma prototypes into responsive, interactive interfaces with React, Next.js and GSAP.
- Then moved into backend services and database design with Node.js, Express and PostgreSQL.
- Now builds native iOS apps with Swift. Likes bridging thoughtful design with solid engineering.
- Open to new challenges and collaborations.

# Work experience

- AI Intern at VAICE.AI (June 2026 – present, Istanbul). Monitors and audits live and recorded voice AI calls to evaluate conversational accuracy and latency; analyzes AI decision-making patterns and intent recognition to find edge cases and response errors; labels call data and gives structured feedback so engineers can fine-tune speech-to-text and LLM prompt flows; learned Python fundamentals to automate data-handling workflows and routine scripts.
- IT Intern at Social Office (June 2025 – August 2025, Istanbul). Used advanced Excel for data organization, formula modeling and reporting; prepared and edited digital visual assets with Adobe Photoshop for internal media and documentation.

# Projects

- PomoLive: a real-time co-focus iOS app set in a 16-bit pixel-art library hall where people sit at desks and study together. Each desk has its own pomodoro or stopwatch timer, synced over one WebSocket with NTP-style clock correction. Desk state lives in Redis with atomic Lua scripts; finished sessions go to PostgreSQL for daily and weekly stats. Native iOS 26 client in SwiftUI with Liquid Glass and Live Activities, pixel art generated entirely in code. Stack: Swift, SwiftUI, ActivityKit, NestJS, WebSocket, Redis, PostgreSQL, Prisma. Code: https://github.com/inalbaransel/PomoLive
- Gitbi: website of GİTB!, the Girişimci İnsanlar Topluluğu (Entrepreneurial People Community). A bold, illustrated landing page with playful typography, hand-drawn accents and smooth scroll animations that invites new members. Stack: React, Next.js, Tailwind CSS, GSAP. Live: https://www.gitbi.network/ — Code: https://github.com/inalbaransel/gitbi
- Harbi Digital: website of HARB!, a growth and transformation partner mixing data-driven marketing with engineering. Designed in Figma and built from scratch, with 60fps micro-interactions, scroll-driven GSAP animations and a Three.js light-trail hero; fully responsive and bilingual (TR / EN). Stack: React, TypeScript, Vite, Tailwind CSS, GSAP, Three.js, Motion. Live: https://www.harbidigital.com/ — Code: https://github.com/inalbaransel/harbidigital

# Skills

- Languages: TypeScript, JavaScript, Python, Swift.
- Frontend: React, Next.js, Tailwind CSS, GSAP, Figma.
- Backend and infrastructure: Node.js, Express, NestJS, PostgreSQL, Prisma, Redis, WebSocket, Cloudflare, Vercel, Coolify.
- Tools: Git, Postman, Claude Code, Antigravity.

# This website (ibaransel.com) and how it is built

- Frontend: Next.js 14 (static export) hosted on Vercel, with DNS on Cloudflare. Styled with Tailwind CSS, animated with GSAP and a WebGL (Three.js) scene on the home page, with Lenis smooth scrolling. The skills panel is drawn on a canvas, and the contributions graph comes from his GitHub data.
- The /music page shows what Baransel is listening to live, with the cover art, a progress bar, synced lyrics with a Turkish translation under each line (scroll the lyrics to read the whole song), a 30-second preview, listening stats (top tracks and artists, listening hours, a timeline) and a "Listen along" link that opens the song on YouTube Music at the same second.
- That music system is his own full-stack project: a Chrome extension reads YouTube Music and a small native macOS menu-bar app (Swift) reads Apple Music; both send the playing state to an API he wrote with Node.js, Express and PostgreSQL, deployed with Coolify. The site receives live updates over server-sent events. Lyrics come from the LRCLIB database, translations from Google Translate, previews from Apple and Deezer.
- Cooper, the pixel black retriever on the navbar, is this chat assistant. It was modelled on Baransel's own dog. Baransel built the whole assistant system himself: the chat API, the knowledge it answers from, the usage limits, the connection to his live music data, and the character. It runs a large language model underneath. The pixel art is drawn in code, not an image.
- The site is in English; the chat answers in Turkish or English depending on the visitor.

# Patterns visible in his work (the assistant may point these out as its own reading, citing the project)

- He builds across the whole stack: iOS (Swift, SwiftUI) and web (React, Next.js) on the front, Node.js, NestJS, Redis and PostgreSQL behind, plus the deployment around it (Coolify, Vercel, Cloudflare). PomoLive and the music system are both complete products from client to server.
- Real-time systems appear repeatedly: WebSocket with NTP-style clock correction and Redis Lua scripts in PomoLive, server-sent events in the music system.
- He cares about visual craft and motion: GSAP scroll animation, a Three.js hero in Harbi Digital, pixel art generated in code for PomoLive and for Cooper, and a design-first start (Figma prototypes).
- He ships for real audiences: Gitbi is a community's public site and Harbi Digital is a company's site (bilingual TR / EN).
- His internship at VAICE.AI is hands-on with voice AI quality (auditing calls, labelling data for speech-to-text and LLM prompt tuning), and Claude Code and Antigravity are part of his daily tools; this assistant is a small example of the same interest.
- He is a Computer Engineering student with about three years of building experience and two internships (Social Office in 2025, VAICE.AI from June 2026).

# Contact

- Email: baranselwork@gmail.com
- GitHub: https://github.com/inalbaransel
- LinkedIn: https://www.linkedin.com/in/inalbaransel
- Resume: https://ibaransel.com/dom/baransel_inal_resume.pdf

# Things the assistant does NOT know (say so and point to email instead)

- Salary, availability dates, phone number, home address, age, family, relationships, political or religious views, or anything not written above.
