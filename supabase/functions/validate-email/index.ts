import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Common disposable/temporary email domains
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'throwam.com', 'sharklasers.com',
  'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'guerrillamail.biz',
  'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'spam4.me',
  'trashmail.com', 'trashmail.at', 'trashmail.io', 'trashmail.me',
  'trashmail.net', 'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
  'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr',
  'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
  'dispostable.com', 'mailnull.com', 'spamgourmet.com', 'spamgourmet.net',
  'spamgourmet.org', 'spam.la', 'tempmail.com', 'temp-mail.org',
  'temp-mail.ru', 'discard.email', 'tempr.email', 'discardmail.com',
  'discardmail.de', 'throwam.com', 'maildrop.cc', 'fakeinbox.com',
  'getnada.com', 'anonaddy.com', 'inboxbear.com', 'spambox.us',
  'mailnesia.com', 'tempinbox.com', 'tempomail.fr', 'throwam.com',
  'emailondeck.com', 'getairmail.com', 'mailexpire.com', 'spamevader.com',
  'safetymail.info', 'dancemail.dk', 'spamfree24.org', 'dodgeit.com',
  'mailmoat.com', 'spamhole.com', 'pookmail.com', 'throwaway.email',
  'mailsac.com', 'binkmail.com', 'bobmail.info', 'chammy.info',
  'devnullmail.com', 'get1mail.com', 'jetable.com', 'trash-amil.com',
  'crazymailing.com', 'urgentmail.biz', 'dingbone.com', 'bodhi.lawlita.com',
  'meltmail.com', 'klzlk.com', 'spamstack.net', 'suremail.info',
  'spaml.de', 'coieo.com', 'tafmail.com', 'vipmail.pw',
  'deyom.com', 'thankyou2010.com', 'throwam.com', 'hulapla.de',
  'tmail.com', 'zippymail.info', 'mailforspam.com', 'spamgob.com',
  'spaml.com', 'trashdevil.com', 'trashdevil.de', 'mailblocks.com',
  'temporaryemail.net', 'emailisvalid.com', 'fakemailgenerator.com',
  'spamfree.eu', 'throwam.com', 'incognitomail.com', 'incognitomail.net',
  'incognitomail.org', 'mailexpire.com', 'safe-mail.net', 'spamgourmet.com',
  'dispostable.com', 'dontreg.com', 'dontsendmespam.de', 'dump-email.info',
  'e4ward.com', 'easytrashmail.com', 'einmalmail.de', 'email60.com',
  'emailinfive.com', 'emailisvalid.com', 'emailtemporario.com.br',
  'emailwarden.com', 'emz.net', 'enterto.com', 'ephemail.net',
  'explodemail.com', 'fakeinbox.org', 'fastacura.com', 'filzmail.com',
  'filzmail.de', 'fizmail.com', 'frapmail.com', 'fudgerub.com',
  'gelitik.in', 'gishpuppy.com', 'givmail.com', 'glitch.sx',
  'goodbye.email', 'gotmail.net', 'gotmail.org', 'gowikibooks.com',
  'gowikicampus.com', 'gowikicars.com', 'gowikifilms.com', 'gowikigames.com',
  'gowikimusic.com', 'gowikinetwork.com', 'gowikitravel.com', 'gowikitv.com',
  'grandmamail.com', 'grandmasmail.com', 'h8s.org', 'hakumail.com',
  'hatespam.org', 'herp.in', 'hidzz.com', 'hochsitze.com',
  'hosting.3utilities.com', 'hot-mail.gq', 'hotpop.com', 'hulapla.de',
]);

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const clientIP = getClientIP(req);
    const rateLimit = await checkRateLimit(supabaseAdmin, `validate-email:ip:${clientIP}`, 10, 60);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) },
        }
      );
    }

    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ valid: false, reason: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2) {
      return new Response(JSON.stringify({ valid: false, reason: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const domain = parts[1];
    const isDisposable = DISPOSABLE_DOMAINS.has(domain);

    console.log(JSON.stringify({ fn: 'validate-email', method: req.method, user_id: null, status: 200, duration_ms: Date.now() - start }));

    return new Response(
      JSON.stringify({
        valid: !isDisposable,
        reason: isDisposable ? 'Disposable email addresses are not allowed' : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error(JSON.stringify({ fn: 'validate-email', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
