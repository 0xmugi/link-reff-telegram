"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Trash2, Copy, Plus, Download, ExternalLink, Bot, Zap, LogOut, Menu, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"

interface BotTemplate {
  id: string
  name: string
  template_url: string
  user_id: string
}

interface GeneratedLink {
  id: string
  botName: string
  link: string
}

/** DexScreener types (minimal yang dipakai) */
type DexPair = {
  chainId: string
  dexId: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceUsd?: string
  liquidity?: { usd?: number }
  marketCap?: number
  fdv?: number
}

export default function ReferralManager() {
  const [user, setUser] = useState<User | null>(null)
  const [botTemplates, setBotTemplates] = useState<BotTemplate[]>([])
  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([])
  const [inputText, setInputText] = useState("")
  const [caInput, setCaInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [isAddingBot, setIsAddingBot] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const axios = require("axios")

const TELEGRAM_TOKEN = "7644445132:AAE4bUfzKqdxptCV3K3JF7BR1qrC85Ob6Dk"
const CHAT_ID = "@testersignalmg" // username channel kamu
const API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`

  // info dari DexScreener untuk template
  const [dexInfo, setDexInfo] = useState<DexPair | null>(null)

  // handle "call by"
  const CALLED_BY = "@shitcoinearly"

  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)
      await loadData()
      setLoading(false)
    }

    checkAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.push("/auth/login")
      }
    })

    return () => subscription.unsubscribe()
  }, [router, supabase.auth])

  const loadData = async () => {
    await loadBotTemplates()

  }

  const loadBotTemplates = async () => {
    const { data, error } = await supabase.from("bot_templates").select("*").order("created_at", { ascending: false })

    if (error) {
      console.error("Error loading bot templates:", error)
      return
    }

    setBotTemplates(data || [])
  }

  const loadCurrentCA = async () => {
    const { data, error } = await supabase.from("current_ca").select("ca_address").limit(1).single()

    if (data && !error) {
      setCaInput(data.ca_address)
    }
  }

  const saveCurrentCA = async (ca: string) => {
    const { error } = await supabase.from("current_ca").upsert({
      ca_address: ca,
      user_id: user?.id,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error("Error saving CA:", error)
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const addBotFromLink = async () => {
    if (!inputText.trim()) {
      toast({
        title: "Error",
        description: "Please paste a referral link",
        variant: "destructive",
      })
      return
    }

    setIsAddingBot(true)
    const link = inputText.trim()

    const botName = detectBotName(link)
    const extractedCA = extractCA(link)

    if (!extractedCA) {
      toast({
        title: "Error",
        description: "No Contract Address found in the link",
        variant: "destructive",
      })
      setIsAddingBot(false)
      return
    }

    const templateUrl = link.replace(extractedCA, "{ca}")

    const { error } = await supabase.from("bot_templates").insert({
      name: botName,
      template_url: templateUrl,
      user_id: user?.id,
    })

    if (error) {
      toast({
        title: "Error",
        description: `Failed to add bot template: ${error.message}`,
        variant: "destructive",
      })
      setIsAddingBot(false)
      return
    }

    await loadBotTemplates()
    setInputText("")
    setIsAddingBot(false)

    toast({
      title: "Success",
      description: `Added ${botName} to your bot list`,
    })
  }

  /** ========= DexScreener Helpers ========= */
  const fetchDexInfo = async (address: string): Promise<DexPair | null> => {
    try {
      // 1) coba endpoint tokens (lebih presisi)
      const t = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
      const tJson = await t.json()
      let pairs: DexPair[] = Array.isArray(tJson?.pairs) ? tJson.pairs : []

      // 2) fallback ke search jika kosong
      if (!pairs.length) {
        const s = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${address}`)
        const sJson = await s.json()
        pairs = Array.isArray(sJson?.pairs) ? sJson.pairs : []
      }

      if (!pairs.length) return null

      // pilih pair dengan liquidity terbesar
      const best = pairs.reduce((acc, cur) => {
        const accL = acc?.liquidity?.usd ?? 0
        const curL = cur?.liquidity?.usd ?? 0
        return curL > accL ? cur : acc
      })

      return best ?? null
    } catch (e) {
      return null
    }
  }

  const formatUsdCompact = (n?: number | null) => {
    if (n == null || isNaN(n)) return "N/A"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: n < 1 ? 6 : 2,
    }).format(n)
  }

  const formatUsdInteger = (n?: number | null) => {
    if (n == null || isNaN(n)) return "N/A"
    // tampil seperti $147,024 (tanpa desimal)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)
  }

  const buildTemplateHeader = (info: DexPair | null, fallbackCA: string) => {
    if (!info) return ""
    const name = info.baseToken?.name ?? "Unknown"
    const symbol = info.baseToken?.symbol ? `$${info.baseToken.symbol}` : ""
    const ca = info.baseToken?.address || fallbackCA
    const price = info.priceUsd ? Number(info.priceUsd) : undefined
    const mc = (info.marketCap ?? info.fdv) as number | undefined
    const liq = info.liquidity?.usd

    return [
      `${name} (${symbol})`.trim(),
      `${ca}`,
      `Market Data MC ${formatUsdInteger(mc)} | Price ${formatUsdCompact(price)}`,
      `Liquidity | ${formatUsdInteger(liq)}`,
      `call by ${CALLED_BY}`,
    ].join("\n")
  }
  /** ======================================= */

  const generateAllLinks = async () => {
    const ca = caInput.trim()
    if (!ca) {
      toast({
        title: "Error",
        description: "Please enter a Contract Address",
        variant: "destructive",
      })
      return
    }

    if (botTemplates.length === 0) {
      toast({
        title: "Error",
        description: "No bots available. Add some bots first.",
        variant: "destructive",
      })
      return
    }

    setIsGenerating(true)

    // ambil data DexScreener (auto detect chain)
    const info = await fetchDexInfo(ca)
    if (!info) {
      setIsGenerating(false)
      setDexInfo(null)
      toast({ title: "Not Found", description: "CA tidak ditemukan di DexScreener", variant: "destructive" })
      return
    }

    setDexInfo(info)
    await saveCurrentCA(ca)

    const newLinks: GeneratedLink[] = botTemplates.map((template) => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      botName: template.name,
      link: template.template_url.replace("{ca}", info.baseToken?.address || ca),
    }))

    setGeneratedLinks(newLinks)
    setIsGenerating(false)

    toast({
      title: "Success",
      description: `Generated ${newLinks.length} referral links`,
    })
  }

  const extractCA = (text: string): string | null => {
    const caRegex = /[A-Za-z0-9]{32,44}/g
    const matches = text.match(caRegex)
    if (matches && matches.length > 0) {
      return matches.reduce((a, b) => (a.length > b.length ? a : b))
    }
    return null
  }

const detectBotName = (link: string): string => {
  try {
    const lowerLink = link.toLowerCase()

    // Daftar bot branding khusus
    const BRANDING: Record<string, string> = {
      maestro: "MaestroSniperBot 🎯",
      soltrading: "SolTradingBot 🤖",
      trojan: "Trojan 🐎",
      axiom: "AXIOM ⚡",
      alph: "ALPH 🔥",
      pepeboost: "Pepeboost 🚀",
      tradewiz: "TradeWiz 🧙",
      bullx: "Bullx Terminal 🐂",
      sigma: "Sigma BuyBot 💰",
      dtrade: "DTrade 📈",
    }

    // cek apakah link mengandung salah satu key branding
    for (const key in BRANDING) {
      if (lowerLink.includes(key)) return BRANDING[key]
    }

    // cek Telegram link
    const telegramMatch = link.match(/t\.me\/([^?\/]+)/)
    if (telegramMatch) {
      // kapitalisasi tiap kata
      const name = telegramMatch[1]
        .replace(/[_-]/g, " ")
        .split(" ")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
      return name + " 🤖"
    }

    // Kalau bukan Telegram, ambil domain
    const url = new URL(link)
    const host = url.hostname.replace(/^www\./, "").split(".")[0]
    const formatted = host
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")

    return formatted + " 🤖"
  } catch {
    return "Unknown Bot 🤖"
  }
}




  const deleteBotTemplate = async (id: string) => {
    const { error } = await supabase.from("bot_templates").delete().eq("id", id)

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete bot template",
        variant: "destructive",
      })
      return
    }

    await loadBotTemplates()
    toast({
      title: "Deleted",
      description: "Bot removed from your list",
    })
  }

  /** ============== COPY HELPERS (pakai template) ============== */
  const copyLink = (link: string, botName: string) => {
    // kalau belum generate Dex info, fallback ke link biasa
    const header = buildTemplateHeader(dexInfo, caInput.trim())
    const textToCopy = header ? `${header}\n• ${botName}: ${link}` : link

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          toast({
            title: "✅ Copied!",
            description: `${botName} template copied successfully`,
            duration: 3000,
            className: "bg-green-50 border-green-200 text-green-800",
          })
        })
        .catch(() => {
          fallbackCopyTextToClipboard(textToCopy, botName)
        })
    } else {
      fallbackCopyTextToClipboard(textToCopy, botName)
    }
  }

const copyAllLinks = () => {
  const header = buildTemplateHeader(dexInfo, caInput.trim())
  // kasih 2 line breaks antar item
  const list = generatedLinks
    .map((item) => `• ${item.botName}: ${item.link}`)
    .join("\n\n") 
  const allText = header ? `${header}\n\n${list}` : list || "No links"

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(allText)
      .then(() => {
        toast({
          title: "✅ All Links Copied!",
          description: `Successfully copied ${generatedLinks.length} link(s) with template`,
          duration: 4000,
          className: "bg-green-50 border-green-200 text-green-800",
        })
      })
      .catch(() => {
        fallbackCopyTextToClipboard(allText, "All Links")
      })
  } else {
    fallbackCopyTextToClipboard(allText, "All Links")
  }
}

const forwardToTelegram = async () => {
  if (!dexInfo || generatedLinks.length === 0) {
    toast({
      title: "Warning",
      description: "Tidak ada data untuk dikirim",
      variant: "destructive",
    });
    return;
  }

  // Helper escape MarkdownV2
  const escapeMarkdownV2 = (text: string) =>
    text.replace(/([_*\[\]()~>#+\-=|{}.!])/g, "\\$1");

  // Header tanpa kata "CA"
  const header = [
    `🔥 ${dexInfo.baseToken?.name} ($${dexInfo.baseToken?.symbol})`,
    `\n\`\`\`\n${dexInfo.baseToken?.address}\n\`\`\``,
    `💰 MC: ${formatUsdInteger((dexInfo.marketCap ?? dexInfo.fdv) as number)}`,
    `💵 Price: ${formatUsdCompact(Number(dexInfo.priceUsd))}`,
    `💧 Liquidity: ${formatUsdInteger(dexInfo.liquidity?.usd)}`,
    `📣 Call by ${CALLED_BY}` // variabel ca tetap aman
  ].join("\n");

  // Entry links
  const entryLinks = generatedLinks
    .map(item => `${item.botName}: ${item.link}`)
    .join("\n\n");

  const messageText = `${header}\n\n🔗 Entry Links:\n${entryLinks}`;
  const escapedText = escapeMarkdownV2(messageText);

  try {
    await axios.post(API_URL, {
      chat_id: CHAT_ID,
      text: escapedText,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
    toast({
      title: "Sukses",
      description: "Berhasil dikirim ke Telegram channel!",
      variant: "default",
    });
  } catch (error) {
    console.error("Gagal kirim ke Telegram:", error);
    toast({
      title: "Error",
      description: "Gagal kirim ke Telegram, cek console.",
      variant: "destructive",
    });
  }
};



const forwardToTwitter = () => {
  const header = buildTemplateHeader(dexInfo, caInput.trim())
  const list = generatedLinks
    .map((item) => `• ${item.botName}: ${item.link}`)
    .join("\n\n")
  const allText = header ? `${header}\n\n${list}` : list || "No links"

  const twUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(allText)}`
  window.open(twUrl, "_blank")
}


  const fallbackCopyTextToClipboard = (text: string, label: string) => {
    const textArea = document.createElement("textarea")
    textArea.value = text
    textArea.style.top = "0"
    textArea.style.left = "0"
    textArea.style.position = "fixed"
    textArea.style.opacity = "0"

    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    try {
      const successful = document.execCommand("copy")
      if (successful) {
        toast({
          title: "✅ Copied!",
          description: `${label} copied successfully`,
          duration: 3000,
          className: "bg-green-50 border-green-200 text-green-800",
        })
      } else {
        throw new Error("Copy command failed")
      }
    } catch (err) {
      toast({
        title: "❌ Copy Failed",
        description: "Please copy the text manually",
        variant: "destructive",
        duration: 3000,
      })
    }

    document.body.removeChild(textArea)
  }
  /** ============================================================ */

  const openLink = (link: string) => {
    window.open(link, "_blank")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Bot className="h-12 w-12 text-emerald-500 mx-auto mb-4 animate-pulse" />
          <p className="text-slate-600">Loading your referral manager...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div
        className={`fixed lg:static inset-y-0 left-0 z-50 w-80 bg-white/90 backdrop-blur-sm border-r border-slate-200 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-800">Referral Manager</h1>
                  <p className="text-sm text-slate-600">Trading Bot Links</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)} className="lg:hidden">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="p-6 border-b border-slate-200">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="h-4 w-4 text-emerald-600" />
              <h2 className="font-semibold text-slate-800">Add Bot</h2>
            </div>
            <div className="space-y-4">
              <Textarea
                placeholder="Paste your referral link here..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="min-h-[80px] border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20 bg-white text-sm"
                disabled={isAddingBot}
              />
              <Button
                onClick={addBotFromLink}
                disabled={isAddingBot}
                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-medium py-2 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                {isAddingBot ? "Adding..." : "Add Bot"}
              </Button>
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <h2 className="font-semibold text-slate-800">Your Bots</h2>
              </div>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                {botTemplates.length}
              </Badge>
            </div>

            {botTemplates.length > 0 ? (
              <div className="space-y-2">
                {botTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-700 truncate">{template.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteBotTemplate(template.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Bot className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm text-slate-500 mb-2">No bots added yet</p>
                <p className="text-xs text-slate-400">Paste a referral link above</p>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-slate-200">
            <Button
              variant="ghost"
              onClick={logout}
              className="w-full text-slate-500 hover:text-slate-700 justify-start"
              size="sm"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-screen">
        <div className="lg:hidden bg-white/90 backdrop-blur-sm border-b border-slate-200 p-4">
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)} className="text-slate-600">
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">
            {botTemplates.length > 0 && (
              <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
                <CardHeader className="pb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-green-600 rounded-xl flex items-center justify-center">
                      <Zap className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-semibold text-slate-800">Generate Links</CardTitle>
                      <CardDescription className="text-slate-600">
                        Enter CA to generate all referral links (auto fetch DexScreener)
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label htmlFor="ca-input" className="text-sm font-semibold text-slate-700 mb-2 block">
                      Contract Address
                    </Label>
                    <input
                      id="ca-input"
                      type="text"
                      placeholder="Enter CA here..."
                      value={caInput}
                      onChange={(e) => setCaInput(e.target.value)}
                      disabled={isGenerating}
                      className="w-full p-4 border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 bg-white transition-all duration-200"
                    />
                  </div>
                  <Button
                    onClick={generateAllLinks}
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-medium py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    <Zap className="h-5 w-5 mr-2" />
                    {isGenerating ? "Generating..." : `Generate All (${botTemplates.length} bots)`}
                  </Button>
                </CardContent>
              </Card>
            )}

            {generatedLinks.length > 0 && (
              <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
<CardHeader className="pb-6">
  <div className="flex items-center justify-between">
    <CardTitle className="text-xl font-semibold text-slate-800">
      Link Reff ({generatedLinks.length})
    </CardTitle>
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={copyAllLinks}
        className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 bg-transparent"
      >
        <Copy className="h-4 w-4 mr-2" />
        Copy All
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={forwardToTelegram}
        className="border-blue-200 text-blue-600 hover:bg-blue-50 bg-transparent"
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        Telegram
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={forwardToTwitter}
        className="border-sky-200 text-sky-600 hover:bg-sky-50 bg-transparent"
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        X
      </Button>
    </div>
  </div>
</CardHeader>

                <CardContent>
{dexInfo && (
  <div className="mb-4 p-5 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white shadow-sm">
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-slate-800">
        {dexInfo.baseToken?.name} (${dexInfo.baseToken?.symbol})
      </h3>
      <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
        LIVE
      </span>
    </div>

    {/* Contract Address */}
    <div className="mt-2">
      <span className="text-xs text-slate-500">CA:</span>{" "}
      <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded select-all">
        {dexInfo.baseToken?.address}
      </span>
    </div>

    {/* Market Data */}
    <div className="mt-3 text-sm space-y-1">
      <div>
        MarketCap:{" "}
        <span className="font-medium">
          {formatUsdInteger((dexInfo.marketCap ?? dexInfo.fdv) as number | undefined)}
        </span>
      </div>
      <div>
        Price:{" "}
        <span className="font-medium">
          {formatUsdCompact(dexInfo.priceUsd ? Number(dexInfo.priceUsd) : undefined)}
        </span>
      </div>
      <div>
        Liquidity:{" "}
        <span className="font-medium">
          {formatUsdInteger(dexInfo.liquidity?.usd)}
        </span>
      </div>
    </div>

    <div className="mt-3 text-xs text-slate-400 italic">
      call by {CALLED_BY}
    </div>
  </div>
)}


                  <div className="space-y-3">
                    {generatedLinks.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border border-slate-200 hover:shadow-md transition-shadow"
                      >
                        <div className="flex-1 min-w-0">
                          <Badge variant="secondary" className="bg-blue-100 text-blue-700 font-medium mb-2">
                            {item.botName}
                          </Badge>
                          <p className="text-xs text-slate-600 font-mono truncate bg-white px-3 py-2 rounded-lg border">
                            {item.link}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyLink(item.link, item.botName)}
                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 p-2"
                            title="Copy template + this link"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openLink(item.link)}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 p-2"
                            title="Open in Telegram"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {botTemplates.length === 0 && (
              <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
                <CardContent className="text-center py-16">
                  <div className="w-20 h-20 bg-gradient-to-r from-slate-200 to-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Bot className="h-10 w-10 text-slate-500" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">No bots added yet</h3>
                  <p className="text-slate-600 mb-6">Use the sidebar to add your first bot</p>
                  <div className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4 max-w-md mx-auto">
                    <p className="font-medium mb-2">How it works:</p>
                    <ol className="text-left space-y-1">
                      <li>1. Paste any referral link in sidebar</li>
                      <li>2. We'll save the bot template</li>
                      <li>3. Generate links with new CA</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <footer className="mt-12 pt-8 border-t border-slate-200/50">
            <div className="max-w-4xl mx-auto text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500 mb-2">
                <span>Crafted with</span>
                <span className="text-red-500">♥</span>
                <span>by</span>
                <a
                  href="https://github.com/0xmugi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  0xMugi
                </a>
              </div>
              <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                <a
                  href="https://github.com/0xmugi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-slate-600 transition-colors flex items-center gap-1"
                >
                  <span>🐙</span>
                  GitHub
                </a>
                <span>•</span>
                <a
                  href="https://x.com/0xmugi_"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-slate-600 transition-colors flex items-center gap-1"
                >
                  <span>🐦</span>X (Twitter)
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
