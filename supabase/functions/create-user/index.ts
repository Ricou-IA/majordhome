import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-app-name, apikey, content-type",
}

interface CreateUserRequest {
  email: string
  password: string
  fullName?: string
  orgId?: string
  appRole?: string
  businessRole?: string
}

function errorResponse(message: string, status: number = 400) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
}

function successResponse(data: unknown, status: number = 200) {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405)
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !caller) {
      return errorResponse("Unauthorized", 401)
    }

    const { data: callerProfile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("app_role, org_id")
      .eq("id", caller.id)
      .single()

    if (profileError || !callerProfile) {
      return errorResponse("Caller profile not found", 403)
    }

    const body: CreateUserRequest = await req.json()
    const { email, password, fullName, orgId, appRole = "user", businessRole } = body

    if (!email || !password) {
      return errorResponse("Email and password are required", 400)
    }

    const isSuperAdmin = callerProfile.app_role === "super_admin"
    const isOrgAdmin = callerProfile.app_role === "org_admin"

    if (!isSuperAdmin) {
      if (!isOrgAdmin) {
        return errorResponse("User not allowed", 403)
      }
      if (orgId && orgId !== callerProfile.org_id) {
        return errorResponse("Cannot create user in another organization", 403)
      }
      if (appRole === "super_admin" || appRole === "org_admin") {
        return errorResponse("Cannot assign this role", 403)
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
      user_metadata: { full_name: fullName?.trim() || null },
    })

    if (createError) {
      return errorResponse(createError.message, 400)
    }

    const newUserId = authData.user.id

    await new Promise(resolve => setTimeout(resolve, 500))

    let orgAppId: string | null = null
    if (orgId) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("app_id")
        .eq("id", orgId)
        .single()
      orgAppId = org?.app_id ?? null
    }

    await supabaseAdmin.from("profiles").update({
      full_name: fullName?.trim() || null,
      app_role: appRole,
      business_role: businessRole || null,
      org_id: orgId || null,
      app_id: orgAppId,
    }).eq("id", newUserId)

    if (orgId) {
      await supabaseAdmin.from("organization_members").insert({
        org_id: orgId,
        user_id: newUserId,
        role: appRole === "org_admin" ? "org_admin" : "member",
        status: "active",
      })
    }

    return successResponse({
      success: true,
      user: {
        id: newUserId,
        email: authData.user.email,
        fullName: fullName?.trim() || null,
        appRole,
        businessRole: businessRole || null,
        orgId: orgId || null,
      }
    }, 201)

  } catch (error) {
    return errorResponse("Internal server error", 500)
  }
})
