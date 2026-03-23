# CoinPayments Intelligence Agent

B2B Sales Intelligence Platform — deploy to Vercel in 10 minutes.

## Deploy to Vercel (No Terminal Needed)

### Option A: Drag & Drop (Easiest)
1. Go to vercel.com → sign up free (use GitHub or email)
2. Click "Add New Project"
3. Click "Upload" or drag this entire folder to the Vercel dashboard
4. Vercel detects Vite automatically
5. Click Deploy 
6. Done — you get a live URL like `coinpayments-agent.vercel.app`

### Option B: GitHub (Permanent + Auto-updates)
1. Create a free GitHub account at github.com
2. Create a new repository called `coinpayments-agent`
3. Upload all these files to the repo
4. Go to vercel.com → New Project → Import from GitHub
5. Select your repo → Deploy
6. Every time you update files on GitHub, Vercel redeploys automatically

## API Keys
Add your keys in the app's Settings panel (🔑 button in nav):
- **Tavily** — app.tavily.com (Starter plan $35/mo)
- **Proxycurl** — nubela.co/proxycurl ($10 credit minimum)

Keys are saved to your browser's localStorage — private to you.

## Local Development (Optional)
```
npm install
npm run dev
```
Opens at http://localhost:3000
