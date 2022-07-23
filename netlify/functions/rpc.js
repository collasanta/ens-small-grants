import { createClient } from '@supabase/supabase-js';
import { verifyTypedData } from 'ethers';
import moment from 'moment';

const supabaseClient = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const domain = {
  name: 'ENS Grants',
  version: '1',
  chainId: 1,
};

const types = {
  Grant: [
    { name: 'address', type: 'address' },
    { name: 'roundId', type: 'uint256' },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'fullText', type: 'string' },
  ],
};

const roundTypes = {
  Round: [
    { name: 'address', type: 'address' },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'allocation_token_address', type: 'address' },
    { name: 'allocation_token_amount', type: 'uint256' },
    { name: 'max_winner_count', type: 'uint64' },
    { name: 'proposal_start', type: 'string' },
    { name: 'proposal_end', type: 'string' },
    { name: 'voting_start', type: 'string' },
    { name: 'voting_end', type: 'string' },
  ],
};

const snapshotTypes = {
  Snapshot: [
    { name: 'roundId', type: 'uint256' },
    { name: 'snapshotProposalId', type: 'string' },
  ],
};

// temporary, hardcoded "admins" for web2 service
const adminAddresses = new Set(['0x9B6568d72A6f6269049Fac3998d1fadf1E6263cc'].map(x => x.toLowerCase()));

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { headers: corsHeaders };
  }

  const { method, ...body } = JSON.parse(event.body);

  switch (method) {
    case 'create_round': {
      const { roundData, signature } = body;

      const recoveredAddress = verifyTypedData(domain, roundTypes, roundData, signature);

      const address = recoveredAddress.toLowerCase();

      if (address !== roundData.address) {
        return {
          body: JSON.stringify({ message: 'invalid signature' }),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          statusCode: 401,
        };
      }

      if (!adminAddresses.has(address)) {
        return {
          body: JSON.stringify({ message: 'not an admin' }),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          statusCode: 401,
        };
      }

      const { data, error } = await supabaseClient.from('rounds').insert([
        {
          title: roundData.title,
          description: roundData.description,
          creator: roundData.address,
          allocation_token_address: roundData.allocation_token_address,
          allocation_token_amount: roundData.allocation_token_amount,
          max_winner_count: roundData.max_winner_count,
          proposal_start: Number.parseInt(roundData.proposal_start),
          proposal_end: Number.parseInt(roundData.proposal_end),
          voting_start: Number.parseInt(roundData.voting_start),
          voting_end: Number.parseInt(roundData.voting_end),
        },
      ]);

      if (error) {
        return {
          body: JSON.stringify(error),
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      return new {
        body: JSON.stringify(data),
        statusCode: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }();
    }
    case 'create_grant': {
      const { grantData, signature } = body;

      const recoveredAddress = verifyTypedData(domain, types, grantData, signature);

      const address = recoveredAddress.toLowerCase();

      if (address !== grantData.address) {
        return {
          body: JSON.stringify({ message: 'invalid signature' }),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          statusCode: 401,
        };
      }

      const { data: rounds, error } = await supabaseClient.from('rounds').select().eq('id', grantData.roundId);

      if (error) {
        return {
          body: JSON.stringify(error),
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      if (rounds.length !== 1) {
        return {
          body: JSON.stringify({ message: 'could not find round' }),
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      const round = rounds[0];

      const now = moment();

      if (now < moment(round.proposal_start)) {
        return {
          body: JSON.stringify({ message: 'proposal period not started' }),
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      if (now > moment(round.proposal_end)) {
        return {
          body: JSON.stringify({ message: 'proposal period ended' }),
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      await supabaseClient.from('grants').update({ deleted: true }).eq('proposer', address);

      const { data, error: grantError } = await supabaseClient.from('grants').insert([
        {
          round_id: grantData.roundId,
          proposer: address,
          title: grantData.title,
          description: grantData.description,
          full_text: grantData.fullText,
        },
      ]);

      if (grantError) {
        return {
          body: JSON.stringify(grantError),
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      return {
        body: JSON.stringify(data),
        statusCode: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      };
    }
    case 'attach_snapshot': {
      const { snapshotData, signature } = body;

      const recoveredAddress = verifyTypedData(domain, snapshotTypes, snapshotData, signature);

      const address = recoveredAddress.toLowerCase();

      if (!adminAddresses.has(address)) {
        return {
          body: JSON.stringify({ message: 'not an admin' }),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          statusCode: 401,
        };
      }

      const { data: rounds, error } = await supabaseClient.from('rounds').select().eq('id', snapshotData.roundId);

      if (error) {
        return {
          body: JSON.stringify(error),
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      if (rounds.length !== 1) {
        return {
          body: JSON.stringify({ message: 'could not find round' }),
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      const round = rounds[0];

      if (round.snapshot_proposal_id) {
        return {
          body: JSON.stringify({ message: 'round already has a snapshot attached' }),
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        };
      }

      await supabaseClient
        .from('rounds')
        .update({ snapshot_proposal_id: snapshotData.snapshotProposalId })
        .eq('id', snapshotData.roundId);

      return {
        body: JSON.stringify({ message: 'done' }),
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      };
    }
    default: {
      return { body: 'not found', statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } };
    }
  }
};