// lib/supabase.js
// Client Supabase centralisé — importer dans toutes les API routes Feelsyst

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_KEY // clé SERVICE (pas anon) pour les API routes

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variables SUPABASE_URL et SUPABASE_SERVICE_KEY manquantes dans .env')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// ============================================================
// CLIENTS
// ============================================================

export async function getClientByEmail(email) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('email', email)
    .single()
  if (error) return null
  return data
}

export async function getClientByStripeId(stripeCustomerId) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()
  if (error) return null
  return data
}

export async function createClient_db(clientData) {
  const { data, error } = await supabase
    .from('clients')
    .insert([clientData])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateClient(id, updates) {
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getAllClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// ============================================================
// USAGE
// ============================================================

export async function incrementUsage(clientId, agent, tokensIn = 0, tokensOut = 0) {
  const today = new Date().toISOString().split('T')[0]

  // Coût estimé Claude Sonnet 4.6 (à ajuster selon tarifs Anthropic)
  const costPerInputToken = 0.000003   // $3 / 1M tokens input
  const costPerOutputToken = 0.000015  // $15 / 1M tokens output
  const estimatedCost = (tokensIn * costPerInputToken) + (tokensOut * costPerOutputToken)

  // Upsert : si la ligne existe pour ce client/agent/jour, on incrémente
  const { error } = await supabase.rpc('increment_usage', {
    p_client_id: clientId,
    p_agent: agent,
    p_date: today,
    p_messages: 1,
    p_tokens_in: tokensIn,
    p_tokens_out: tokensOut,
    p_cost: estimatedCost
  })

  if (error) {
    // Fallback : insert simple si la fonction RPC n'existe pas encore
    await supabase.from('usage').insert([{
      client_id: clientId,
      agent,
      date: today,
      messages_count: 1,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      estimated_cost: estimatedCost
    }])
  }
}

export async function getUsageByClient(clientId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('usage')
    .select('*')
    .eq('client_id', clientId)
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) throw error
  return data
}

// ============================================================
// PAIEMENTS
// ============================================================

export async function recordPayment(paymentData) {
  const { data, error } = await supabase
    .from('payments')
    .insert([paymentData])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getPaymentsByClient(clientId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// ============================================================
// PROSPECTS
// ============================================================

export async function upsertProspect(prospectData) {
  const { data, error } = await supabase
    .from('prospects')
    .upsert([prospectData], { onConflict: 'email' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProspectStatus(id, status, notes = null) {
  const updates = { status }
  if (notes) updates.notes = notes
  const { data, error } = await supabase
    .from('prospects')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================================
// TICKETS SUPPORT
// ============================================================

export async function createTicket(ticketData) {
  const { data, error } = await supabase
    .from('support_tickets')
    .insert([ticketData])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getOpenTickets() {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*, clients(email, company_name, plan)')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// ============================================================
// AGENT CONFIGS
// ============================================================

export async function getAgentConfig(agent) {
  const { data, error } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('agent', agent)
    .single()
  if (error) return null
  return data
}

export async function updateAgentPrompt(agent, systemPrompt) {
  const { data, error } = await supabase
    .from('agent_configs')
    .update({ system_prompt: systemPrompt })
    .eq('agent', agent)
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================================
// ADMIN LOGS
// ============================================================

export async function logAdminAction(action, targetType, targetId, details = {}) {
  await supabase.from('admin_logs').insert([{
    action,
    target_type: targetType,
    target_id: String(targetId),
    details
  }])
  // On ne throw pas ici — les logs ne doivent jamais bloquer une action
}

// ============================================================
// ALERTES
// ============================================================

export async function createAlert(type, severity, title, message, clientId = null) {
  await supabase.from('admin_alerts').insert([{
    type, severity, title, message, client_id: clientId
  }])
}

export async function getUnreadAlerts() {
  const { data, error } = await supabase
    .from('admin_alerts')
    .select('*, clients(email, company_name)')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
  if (error) return []
  return data
}

export async function markAlertRead(id) {
  await supabase.from('admin_alerts').update({ is_read: true }).eq('id', id)
}

// ============================================================
// VUES DASHBOARD
// ============================================================

export async function getDashboardStats() {
  const [mrrResult, alertsResult, trialsResult, usageResult] = await Promise.all([
    supabase.from('view_mrr').select('*'),
    supabase.from('admin_alerts').select('id').eq('is_read', false),
    supabase.from('view_expiring_trials').select('*'),
    supabase.from('usage')
      .select('estimated_cost')
      .gte('date', new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString().split('T')[0])
  ])

  const mrr = (mrrResult.data || []).reduce((sum, row) => sum + (row.mrr_euros || 0), 0)
  const apiCostThisMonth = (usageResult.data || [])
    .reduce((sum, row) => sum + (row.estimated_cost || 0), 0)

  return {
    mrr,
    apiCostThisMonth,
    unreadAlerts: alertsResult.data?.length || 0,
    expiringTrials: trialsResult.data || []
  }
      }
