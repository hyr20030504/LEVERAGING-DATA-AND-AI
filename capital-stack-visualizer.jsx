import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Legend, Area, AreaChart,
  RadialBarChart, RadialBar
} from "recharts";
import {
  TrendingUp, DollarSign, Percent, Building2, Clock, Target,
  ChevronDown, ChevronUp, Sparkles, AlertTriangle, CheckCircle,
  BarChart3, PieChart as PieIcon, Layers, Brain, ArrowRight,
  Shield, Zap, Info
} from "lucide-react";

/* ─────────────────────── FINANCIAL ENGINE ─────────────────────── */

function computeCapitalStack(inputs) {
  const {
    acquisitionCost,
    ltv,
    loanRate,
    holdingYears,
    exitCapRate,
    noiYield = 6.5,
    annualNoiGrowth = 2.5,
    catchUpPercent = 100,
    prefReturn = 8,
    lpSplit = 80,
    gpSplit = 20
  } = inputs;

  // Capital structure
  const debtAmount = acquisitionCost * (ltv / 100);
  const equityAmount = acquisitionCost - debtAmount;
  const annualDebtService = debtAmount * (loanRate / 100);

  // NOI schedule
  const noiSchedule = [];
  const baseNoi = acquisitionCost * (noiYield / 100);
  for (let y = 1; y <= holdingYears; y++) {
    const noi = baseNoi * Math.pow(1 + annualNoiGrowth / 100, y - 1);
    noiSchedule.push(noi);
  }

  // Cash flows to equity
  const cashFlowsToEquity = noiSchedule.map(noi => noi - annualDebtService);

  // Exit value
  const terminalNoi = baseNoi * Math.pow(1 + annualNoiGrowth / 100, holdingYears);
  const exitValue = terminalNoi / (exitCapRate / 100);
  const exitEquity = exitValue - debtAmount;

  // DSCR
  const dscr = noiSchedule[0] / annualDebtService;

  // Debt yield
  const debtYield = (noiSchedule[0] / debtAmount) * 100;

  // Interest coverage
  const interestCoverage = noiSchedule[0] / annualDebtService;

  // ─── Project-level IRR ───
  const projectCashFlows = [-acquisitionCost];
  for (let y = 0; y < holdingYears; y++) {
    if (y === holdingYears - 1) {
      projectCashFlows.push(noiSchedule[y] + exitValue);
    } else {
      projectCashFlows.push(noiSchedule[y]);
    }
  }
  const projectIRR = computeIRR(projectCashFlows);

  // ─── Equity-level IRR (before waterfall) ───
  const equityCashFlows = [-equityAmount];
  for (let y = 0; y < holdingYears; y++) {
    if (y === holdingYears - 1) {
      equityCashFlows.push(cashFlowsToEquity[y] + exitEquity);
    } else {
      equityCashFlows.push(cashFlowsToEquity[y]);
    }
  }
  const equityIRR = computeIRR(equityCashFlows);

  // ─── Waterfall distribution ───
  const totalEquityProceeds = cashFlowsToEquity.reduce((a, b) => a + b, 0) + exitEquity;
  const totalProfit = totalEquityProceeds - equityAmount;

  // Tier 1: Preferred return to LP (compounded)
  const prefReturnTotal = equityAmount * Math.pow(1 + prefReturn / 100, holdingYears) - equityAmount;
  
  let remainingProfit = totalProfit;
  
  // LP gets preferred return first
  const lpPrefReturn = Math.min(remainingProfit, prefReturnTotal);
  remainingProfit -= lpPrefReturn;

  // Tier 2: GP catch-up
  const gpCatchUpTarget = (lpPrefReturn / (lpSplit / 100)) * (gpSplit / 100);
  const gpCatchUp = Math.min(remainingProfit, gpCatchUpTarget * (catchUpPercent / 100));
  remainingProfit -= gpCatchUp;

  // Tier 3: Remaining split
  const lpResidual = remainingProfit * (lpSplit / 100);
  const gpResidual = remainingProfit * (gpSplit / 100);

  const totalLpProceeds = equityAmount + lpPrefReturn + lpResidual;
  const totalGpProceeds = gpCatchUp + gpResidual;

  // LP IRR (simplified — distribute waterfall proportionally)
  const lpShare = totalLpProceeds / totalEquityProceeds;
  const gpShare = totalGpProceeds / totalEquityProceeds;

  const lpCashFlows = [-equityAmount];
  for (let y = 0; y < holdingYears; y++) {
    if (y === holdingYears - 1) {
      const totalFinal = cashFlowsToEquity[y] + exitEquity;
      lpCashFlows.push(totalFinal * lpShare);
    } else {
      lpCashFlows.push(cashFlowsToEquity[y] * lpShare);
    }
  }
  const lpIRR = computeIRR(lpCashFlows);

  // GP Multiple
  const gpInvestment = 0; // GP puts no capital
  const gpMultiple = totalGpProceeds > 0 ? Infinity : 0;
  const gpPromoteMultiple = totalGpProceeds / (equityAmount * (gpSplit / 100));

  // LP Multiple
  const lpEquityMultiple = totalLpProceeds / equityAmount;

  // Annual cash flow data for charts
  const annualData = noiSchedule.map((noi, i) => ({
    year: `Year ${i + 1}`,
    noi: Math.round(noi),
    debtService: Math.round(annualDebtService),
    cashFlow: Math.round(cashFlowsToEquity[i]),
    cumulativeCF: Math.round(
      cashFlowsToEquity.slice(0, i + 1).reduce((a, b) => a + b, 0)
    )
  }));

  // Add exit year data
  const exitYearData = {
    year: `Exit`,
    noi: 0,
    debtService: 0,
    cashFlow: Math.round(exitEquity),
    capitalGain: Math.round(exitEquity),
    cumulativeCF: Math.round(totalEquityProceeds)
  };

  return {
    debtAmount,
    equityAmount,
    annualDebtService,
    noiSchedule,
    cashFlowsToEquity,
    exitValue,
    exitEquity,
    dscr,
    debtYield,
    interestCoverage,
    projectIRR,
    equityIRR,
    lpIRR,
    lpEquityMultiple,
    gpPromoteMultiple,
    totalLpProceeds,
    totalGpProceeds,
    lpPrefReturn,
    gpCatchUp,
    lpResidual,
    gpResidual,
    totalProfit,
    annualData,
    exitYearData,
    terminalNoi,
    baseNoi,
    prefReturnTotal
  };
}

function computeIRR(cashFlows, guess = 0.1) {
  const maxIter = 1000;
  const tol = 1e-8;
  let rate = guess;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      dnpv -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dnpv) < 1e-14) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
  }
  return rate;
}

/* ─────────────────────── FORMATTING ─────────────────────── */

const fmt = {
  currency: (v) => {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  },
  currencyFull: (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
  pct: (v) => `${(v * 100).toFixed(1)}%`,
  pctRaw: (v) => `${v.toFixed(1)}%`,
  multiple: (v) => v === Infinity ? "∞x" : `${v.toFixed(2)}x`
};

/* ─────────────────────── SLIDER COMPONENT ─────────────────────── */

function InputSlider({ label, value, onChange, min, max, step, unit, icon: Icon, color = "#c9a96e" }) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="group" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon && <Icon size={14} style={{ color, opacity: 0.8 }} />}
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            fontFamily: "'JetBrains Mono', monospace"
          }}>{label}</span>
        </div>
        <span style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-primary)",
          fontFamily: "'JetBrains Mono', monospace",
          background: "var(--surface-hover)",
          padding: "2px 10px",
          borderRadius: 6
        }}>
          {unit === "$" ? fmt.currencyFull(value) : `${value}${unit}`}
        </span>
      </div>
      <div style={{ position: "relative", height: 36, display: "flex", alignItems: "center" }}>
        <div style={{
          position: "absolute",
          left: 0, right: 0, top: "50%", transform: "translateY(-50%)",
          height: 6, borderRadius: 3,
          background: "var(--surface-elevated)",
          overflow: "hidden"
        }}>
          <div style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 3,
            background: `linear-gradient(90deg, ${color}66, ${color})`,
            transition: "width 0.05s ease"
          }} />
        </div>
        <input
          type="range"
          min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{
            position: "absolute",
            left: 0, right: 0,
            width: "100%",
            height: 36,
            opacity: 0,
            cursor: "pointer",
            zIndex: 2
          }}
        />
        <div style={{
          position: "absolute",
          left: `${pct}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 18, height: 18,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 12px ${color}55`,
          border: "3px solid var(--bg-primary)",
          transition: "transform 0.1s ease, box-shadow 0.1s ease",
          pointerEvents: "none",
          zIndex: 1
        }} />
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 10, color: "var(--text-tertiary)",
        fontFamily: "'JetBrains Mono', monospace",
        marginTop: 2
      }}>
        <span>{unit === "$" ? fmt.currency(min) : `${min}${unit}`}</span>
        <span>{unit === "$" ? fmt.currency(max) : `${max}${unit}`}</span>
      </div>
    </div>
  );
}

/* ─────────────────────── METRIC CARD ─────────────────────── */

function MetricCard({ label, value, sub, icon: Icon, accent = "#c9a96e", pulse = false }) {
  return (
    <div style={{
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 12,
      padding: "18px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      position: "relative",
      overflow: "hidden",
      transition: "border-color 0.3s ease, box-shadow 0.3s ease"
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = accent + "55";
        e.currentTarget.style.boxShadow = `0 4px 20px ${accent}15`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--border-subtle)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {Icon && <Icon size={13} style={{ color: accent }} />}
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          fontFamily: "'JetBrains Mono', monospace"
        }}>{label}</span>
      </div>
      <div style={{
        fontSize: 26,
        fontWeight: 800,
        color: accent,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1
      }}>
        {value}
      </div>
      {sub && (
        <span style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          fontFamily: "'JetBrains Mono', monospace"
        }}>{sub}</span>
      )}
    </div>
  );
}

/* ─────────────────────── WATERFALL TABLE ─────────────────────── */

function WaterfallTable({ data }) {
  const rows = [
    { label: "Preferred Return (8% to LP)", lp: data.lpPrefReturn, gp: 0, tier: 1 },
    { label: "GP Catch-Up", lp: 0, gp: data.gpCatchUp, tier: 2 },
    { label: "Residual Split (80/20)", lp: data.lpResidual, gp: data.gpResidual, tier: 3 },
    { label: "Return of Capital", lp: data.equityAmount, gp: 0, tier: 0 },
    { label: "Total Distributions", lp: data.totalLpProceeds, gp: data.totalGpProceeds, tier: -1 }
  ];

  const tierColors = {
    0: "#8895a7",
    1: "#c9a96e",
    2: "#6ec9b0",
    3: "#6ea5c9",
    "-1": "var(--text-primary)"
  };

  return (
    <div style={{
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 12,
      overflow: "hidden"
    }}>
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", gap: 8
      }}>
        <Layers size={14} style={{ color: "#c9a96e" }} />
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "var(--text-secondary)",
          fontFamily: "'JetBrains Mono', monospace"
        }}>Waterfall Distribution</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            {["Tier", "LP", "GP"].map(h => (
              <th key={h} style={{
                padding: "10px 18px",
                textAlign: h === "Tier" ? "left" : "right",
                fontSize: 10, fontWeight: 600,
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: "var(--text-tertiary)",
                fontFamily: "'JetBrains Mono', monospace"
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{
              borderBottom: i === rows.length - 2 ? "2px solid var(--border-subtle)" :
                i < rows.length - 1 ? "1px solid var(--border-subtle)" : "none",
              background: r.tier === -1 ? "var(--surface-hover)" : "transparent"
            }}>
              <td style={{
                padding: "12px 18px",
                fontSize: 12, color: tierColors[r.tier],
                fontWeight: r.tier === -1 ? 700 : 500,
                fontFamily: "'JetBrains Mono', monospace"
              }}>
                {r.tier > 0 && (
                  <span style={{
                    display: "inline-block", width: 18, height: 18,
                    borderRadius: 4, textAlign: "center", lineHeight: "18px",
                    fontSize: 10, fontWeight: 700, marginRight: 8,
                    background: tierColors[r.tier] + "22",
                    color: tierColors[r.tier]
                  }}>{r.tier}</span>
                )}
                {r.label}
              </td>
              <td style={{
                padding: "12px 18px", textAlign: "right",
                fontSize: 13, fontWeight: r.tier === -1 ? 700 : 500,
                fontFamily: "'JetBrains Mono', monospace",
                color: r.lp > 0 ? "#c9a96e" : "var(--text-tertiary)"
              }}>{fmt.currency(r.lp)}</td>
              <td style={{
                padding: "12px 18px", textAlign: "right",
                fontSize: 13, fontWeight: r.tier === -1 ? 700 : 500,
                fontFamily: "'JetBrains Mono', monospace",
                color: r.gp > 0 ? "#6ec9b0" : "var(--text-tertiary)"
              }}>{fmt.currency(r.gp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── CUSTOM TOOLTIP ─────────────────────── */

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 8,
      padding: "10px 14px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.3)"
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, marginBottom: 6,
        color: "var(--text-secondary)",
        fontFamily: "'JetBrains Mono', monospace"
      }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", gap: 16,
          fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
          color: p.color, marginBottom: 2
        }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{fmt.currency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── AI PANEL ─────────────────────── */

function AIInsightsPanel({ inputs, data }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generateInsight = useCallback(async () => {
    setLoading(true);
    setError(null);

    const prompt = `You are a senior real estate investment analyst on an Investment Committee. Analyze this deal and provide a concise ~150 word assessment.

DEAL PARAMETERS:
- Total Acquisition Cost: ${fmt.currencyFull(inputs.acquisitionCost)}
- LTV: ${inputs.ltv}%
- Loan Rate: ${inputs.loanRate}%
- Hold Period: ${inputs.holdingYears} years
- Exit Cap Rate: ${inputs.exitCapRate}%
- NOI Yield: ${inputs.noiYield}%

KEY METRICS:
- DSCR: ${data.dscr.toFixed(2)}x
- Debt Yield: ${data.debtYield.toFixed(1)}%
- Project IRR: ${fmt.pct(data.projectIRR)}
- LP IRR: ${fmt.pct(data.lpIRR)}
- Equity Multiple: ${data.lpEquityMultiple.toFixed(2)}x
- GP Promote Multiple: ${data.gpPromoteMultiple.toFixed(2)}x

Provide your assessment in this JSON format:
{
  "riskLevel": "LOW" | "MODERATE" | "HIGH",
  "summary": "one sentence overall assessment",
  "leverage": "assessment of leverage and DSCR",
  "returns": "assessment of return profile and waterfall structure",
  "recommendation": "your recommendation with one specific suggestion"
}

Respond ONLY with valid JSON, no markdown.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const result = await response.json();
      const text = result.content?.map(c => c.text || "").join("") || "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      setInsight(parsed);
    } catch (err) {
      console.error("AI Error:", err);
      setError("Failed to generate analysis. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [inputs, data]);

  const riskColors = {
    LOW: "#4ade80",
    MODERATE: "#f59e0b",
    HIGH: "#ef4444"
  };

  const riskIcons = {
    LOW: CheckCircle,
    MODERATE: AlertTriangle,
    HIGH: AlertTriangle
  };

  return (
    <div style={{
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 16,
      overflow: "hidden"
    }}>
      {/* Header */}
      <div style={{
        padding: "18px 24px",
        background: "linear-gradient(135deg, var(--surface-elevated) 0%, var(--surface-card) 100%)",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #c9a96e22, #6ec9b022)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Brain size={16} style={{ color: "#c9a96e" }} />
          </div>
          <div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--text-primary)",
              fontFamily: "'JetBrains Mono', monospace"
            }}>AI Investment Committee Associate</div>
            <div style={{
              fontSize: 10,
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace"
            }}>Powered by Claude Sonnet</div>
          </div>
        </div>
        <button
          onClick={generateInsight}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: loading
              ? "var(--surface-elevated)"
              : "linear-gradient(135deg, #c9a96e, #b8944f)",
            color: loading ? "var(--text-tertiary)" : "#0f1219",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            cursor: loading ? "wait" : "pointer",
            fontFamily: "'JetBrains Mono', monospace",
            transition: "all 0.2s ease",
            boxShadow: loading ? "none" : "0 4px 16px #c9a96e33"
          }}
        >
          {loading ? (
            <>
              <div style={{
                width: 14, height: 14,
                border: "2px solid var(--text-tertiary)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate AI Insights
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px" }}>
        {error && (
          <div style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "#ef444415",
            border: "1px solid #ef444433",
            color: "#ef4444",
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace"
          }}>
            <AlertTriangle size={14} style={{ marginRight: 8, verticalAlign: "middle" }} />
            {error}
          </div>
        )}

        {!insight && !loading && !error && (
          <div style={{
            textAlign: "center",
            padding: "32px 20px",
            color: "var(--text-tertiary)"
          }}>
            <Brain size={36} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
            <div style={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 4
            }}>Click "Generate AI Insights" for a deal assessment</div>
            <div style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              opacity: 0.6
            }}>Analysis includes leverage risk, return assessment, and recommendations</div>
          </div>
        )}

        {loading && (
          <div style={{
            textAlign: "center",
            padding: "36px 20px"
          }}>
            <div style={{
              width: 40, height: 40, margin: "0 auto 16px",
              border: "3px solid var(--border-subtle)",
              borderTopColor: "#c9a96e",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite"
            }} />
            <div style={{
              fontSize: 12, color: "var(--text-secondary)",
              fontFamily: "'JetBrains Mono', monospace"
            }}>Running investment analysis...</div>
          </div>
        )}

        {insight && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Risk Badge & Summary */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 14,
              padding: "16px",
              borderRadius: 10,
              background: `${riskColors[insight.riskLevel]}08`,
              border: `1px solid ${riskColors[insight.riskLevel]}22`
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: `${riskColors[insight.riskLevel]}15`,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {(() => {
                  const RIcon = riskIcons[insight.riskLevel];
                  return <RIcon size={18} style={{ color: riskColors[insight.riskLevel] }} />;
                })()}
              </div>
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: riskColors[insight.riskLevel],
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 4
                }}>
                  {insight.riskLevel} RISK
                </div>
                <div style={{
                  fontSize: 13,
                  color: "var(--text-primary)",
                  lineHeight: 1.5,
                  fontFamily: "'JetBrains Mono', monospace"
                }}>
                  {insight.summary}
                </div>
              </div>
            </div>

            {/* Detail Cards */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12
            }}>
              {[
                { icon: Shield, label: "Leverage Analysis", text: insight.leverage, color: "#6ea5c9" },
                { icon: TrendingUp, label: "Return Profile", text: insight.returns, color: "#c9a96e" },
              ].map((card, i) => (
                <div key={i} style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border-subtle)"
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 8
                  }}>
                    <card.icon size={12} style={{ color: card.color }} />
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      color: card.color,
                      fontFamily: "'JetBrains Mono', monospace"
                    }}>{card.label}</span>
                  </div>
                  <div style={{
                    fontSize: 12, lineHeight: 1.6,
                    color: "var(--text-secondary)",
                    fontFamily: "'JetBrains Mono', monospace"
                  }}>{card.text}</div>
                </div>
              ))}
            </div>

            {/* Recommendation */}
            <div style={{
              padding: "14px 16px",
              borderRadius: 10,
              background: "#c9a96e0a",
              borderLeft: "3px solid #c9a96e"
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 6
              }}>
                <Zap size={12} style={{ color: "#c9a96e" }} />
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#c9a96e",
                  fontFamily: "'JetBrains Mono', monospace"
                }}>Recommendation</span>
              </div>
              <div style={{
                fontSize: 12, lineHeight: 1.6,
                color: "var(--text-primary)",
                fontFamily: "'JetBrains Mono', monospace"
              }}>{insight.recommendation}</div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─────────────────────── SECTION HEADER ─────────────────────── */

function SectionHeader({ icon: Icon, title, color = "#c9a96e" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      marginBottom: 18
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: `${color}15`,
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <Icon size={14} style={{ color }} />
      </div>
      <span style={{
        fontSize: 13, fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-secondary)",
        fontFamily: "'JetBrains Mono', monospace"
      }}>{title}</span>
      <div style={{
        flex: 1, height: 1,
        background: "var(--border-subtle)"
      }} />
    </div>
  );
}

/* ═══════════════════════ MAIN APP ═══════════════════════ */

export default function App() {
  const [acquisitionCost, setAcquisitionCost] = useState(25000000);
  const [ltv, setLtv] = useState(65);
  const [loanRate, setLoanRate] = useState(5.5);
  const [holdingYears, setHoldingYears] = useState(5);
  const [exitCapRate, setExitCapRate] = useState(5.5);
  const [noiYield, setNoiYield] = useState(6.5);

  const inputs = { acquisitionCost, ltv, loanRate, holdingYears, exitCapRate, noiYield };
  const data = useMemo(() => computeCapitalStack(inputs), [acquisitionCost, ltv, loanRate, holdingYears, exitCapRate, noiYield]);

  // Pie chart data
  const pieData = [
    { name: "Senior Debt", value: data.debtAmount, color: "#6ea5c9" },
    { name: "Equity", value: data.equityAmount, color: "#c9a96e" }
  ];

  // Waterfall bar data
  const waterfallBarData = [
    { name: "Pref Return", LP: data.lpPrefReturn, GP: 0 },
    { name: "Catch-Up", LP: 0, GP: data.gpCatchUp },
    { name: "Residual", LP: data.lpResidual, GP: data.gpResidual }
  ];

  const irrGood = data.projectIRR > 0.12;
  const dscrSafe = data.dscr > 1.25;

  return (
    <div style={{
      "--bg-primary": "#0f1219",
      "--bg-secondary": "#141820",
      "--surface-card": "#1a1f2b",
      "--surface-elevated": "#222838",
      "--surface-hover": "#2a3144",
      "--border-subtle": "#2d3548",
      "--text-primary": "#e8e4df",
      "--text-secondary": "#9ea3b0",
      "--text-tertiary": "#5e6370",
      "--gold": "#c9a96e",
      "--blue": "#6ea5c9",
      "--green": "#6ec9b0",
      "--red": "#c96e6e",
      minHeight: "100vh",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      fontFamily: "'JetBrains Mono', monospace",
      padding: 0,
      margin: 0
    }}>

      {/* ──── Fonts ──── */}
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* ──── HERO HEADER ──── */}
      <div style={{
        padding: "32px 40px 24px",
        background: "linear-gradient(180deg, #141820 0%, #0f1219 100%)",
        borderBottom: "1px solid var(--border-subtle)"
      }}>
        <div style={{ maxWidth: 1360, margin: "0 auto" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            marginBottom: 4
          }}>
            <Building2 size={16} style={{ color: "#c9a96e" }} />
            <span style={{
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.15em", textTransform: "uppercase",
              color: "var(--text-tertiary)"
            }}>AI in Real Estate Development</span>
          </div>
          <h1 style={{
            fontSize: 28, fontWeight: 800,
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
            margin: "6px 0 4px"
          }}>
            Live Capital Stack <span style={{ color: "#c9a96e" }}>&</span> Return Visualizer
          </h1>
          <p style={{
            fontSize: 12, color: "var(--text-tertiary)",
            letterSpacing: "0.02em", margin: 0
          }}>
            Real-time waterfall modeling with AI-powered deal analysis
          </p>
        </div>
      </div>

      {/* ──── KPI STRIP ──── */}
      <div style={{
        padding: "20px 40px",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-subtle)"
      }}>
        <div style={{
          maxWidth: 1360, margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 12
        }}>
          <MetricCard label="Project IRR" value={fmt.pct(data.projectIRR)} icon={TrendingUp} accent={irrGood ? "#4ade80" : "#f59e0b"} />
          <MetricCard label="LP IRR" value={fmt.pct(data.lpIRR)} icon={Target} accent="#c9a96e" />
          <MetricCard label="LP Equity Multiple" value={fmt.multiple(data.lpEquityMultiple)} icon={Layers} accent="#c9a96e" />
          <MetricCard label="GP Promote" value={fmt.multiple(data.gpPromoteMultiple)} icon={Zap} accent="#6ec9b0" />
          <MetricCard label="DSCR" value={data.dscr.toFixed(2) + "x"} icon={Shield} accent={dscrSafe ? "#4ade80" : "#ef4444"} sub={dscrSafe ? "Adequate" : "Below threshold"} />
          <MetricCard label="Exit Value" value={fmt.currency(data.exitValue)} icon={DollarSign} accent="#6ea5c9" />
        </div>
      </div>

      {/* ──── MAIN CONTENT ──── */}
      <div style={{
        maxWidth: 1360, margin: "0 auto",
        padding: "28px 40px",
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        gap: 28
      }}>
        {/* ── LEFT: Controls ── */}
        <div>
          <SectionHeader icon={BarChart3} title="Deal Parameters" />
          <div style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: "22px 20px"
          }}>
            <InputSlider label="Total Acquisition Cost" value={acquisitionCost} onChange={setAcquisitionCost}
              min={5000000} max={100000000} step={500000} unit="$" icon={DollarSign} color="#c9a96e" />
            <InputSlider label="Loan-to-Value (LTV)" value={ltv} onChange={setLtv}
              min={0} max={85} step={1} unit="%" icon={Percent} color="#6ea5c9" />
            <InputSlider label="Loan Interest Rate" value={loanRate} onChange={setLoanRate}
              min={2} max={12} step={0.1} unit="%" icon={Percent} color="#6ea5c9" />
            <InputSlider label="Holding Period" value={holdingYears} onChange={setHoldingYears}
              min={1} max={10} step={1} unit=" yrs" icon={Clock} color="#6ec9b0" />
            <InputSlider label="Exit Cap Rate" value={exitCapRate} onChange={setExitCapRate}
              min={3} max={10} step={0.1} unit="%" icon={Target} color="#c96e6e" />
            <InputSlider label="NOI Yield (Going-in)" value={noiYield} onChange={setNoiYield}
              min={3} max={12} step={0.1} unit="%" icon={TrendingUp} color="#c9a96e" />
          </div>

          {/* Quick stats below sliders */}
          <div style={{
            marginTop: 16,
            padding: "14px 16px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            display: "flex", flexDirection: "column", gap: 8
          }}>
            {[
              { label: "Senior Debt", value: fmt.currencyFull(data.debtAmount), color: "#6ea5c9" },
              { label: "Equity Required", value: fmt.currencyFull(data.equityAmount), color: "#c9a96e" },
              { label: "Annual Debt Service", value: fmt.currencyFull(data.annualDebtService), color: "var(--text-secondary)" },
              { label: "Year 1 NOI", value: fmt.currencyFull(data.baseNoi), color: "var(--text-secondary)" },
              { label: "Debt Yield", value: data.debtYield.toFixed(1) + "%", color: "var(--text-secondary)" },
            ].map((row, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace"
              }}>
                <span style={{ color: "var(--text-tertiary)" }}>{row.label}</span>
                <span style={{ color: row.color, fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Charts & Tables ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Row 1: Pie + Waterfall Bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Capital Structure Pie */}
            <div style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 20
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 14
              }}>
                <PieIcon size={14} style={{ color: "#c9a96e" }} />
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "var(--text-secondary)"
                }}>Capital Structure</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    animationDuration={400}
                    animationEasing="ease-out"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 8 }}>
                {pieData.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {d.name} ({((d.value / acquisitionCost) * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Waterfall Distribution Bar */}
            <div style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 20
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 14
              }}>
                <Layers size={14} style={{ color: "#c9a96e" }} />
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "var(--text-secondary)"
                }}>Profit Distribution</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={waterfallBarData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d354822" />
                  <XAxis dataKey="name" tick={{ fill: "#5e6370", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#5e6370", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false}
                    tickFormatter={v => fmt.currency(v)} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="LP" fill="#c9a96e" radius={[4, 4, 0, 0]} animationDuration={400} />
                  <Bar dataKey="GP" fill="#6ec9b0" radius={[4, 4, 0, 0]} animationDuration={400} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: "#c9a96e" }} />
                  <span style={{ color: "var(--text-tertiary)" }}>LP</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: "#6ec9b0" }} />
                  <span style={{ color: "var(--text-tertiary)" }}>GP</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Cash Flow Chart */}
          <div style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 12,
            padding: 20
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 14
            }}>
              <BarChart3 size={14} style={{ color: "#c9a96e" }} />
              <span style={{
                fontSize: 11, fontWeight: 700,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--text-secondary)"
              }}>Annual Cash Flow to Equity</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.annualData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d354822" />
                <XAxis dataKey="year" tick={{ fill: "#5e6370", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#5e6370", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false}
                  tickFormatter={v => fmt.currency(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="noi" name="NOI" fill="#6ea5c966" radius={[4, 4, 0, 0]} animationDuration={400} />
                <Bar dataKey="debtService" name="Debt Service" fill="#c96e6e55" radius={[4, 4, 0, 0]} animationDuration={400} />
                <Bar dataKey="cashFlow" name="Cash to Equity" fill="#c9a96e" radius={[4, 4, 0, 0]} animationDuration={400} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Row 3: Waterfall Table */}
          <WaterfallTable data={data} />

          {/* Row 4: AI Insights */}
          <SectionHeader icon={Brain} title="AI Investment Analysis" color="#6ec9b0" />
          <AIInsightsPanel inputs={inputs} data={data} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "16px 40px",
        borderTop: "1px solid var(--border-subtle)",
        textAlign: "center",
        marginTop: 28
      }}>
        <span style={{
          fontSize: 10,
          color: "var(--text-tertiary)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace"
        }}>
          AI in Real Estate Development · Capital Stack Visualizer · Built with React + Recharts + Claude AI
        </span>
      </div>
    </div>
  );
}
