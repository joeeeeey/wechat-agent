// A device-side D1 adapter. Credentials supplied by an external owner, never logged.
// No public device-write endpoint, no Access bypass, no browser credential access.
export class RescueD1 {
  constructor({account,database,token,fetcher=fetch}) {
    if(!/^[a-f0-9]{32}$/i.test(account) || !/^[a-f0-9-]{36}$/i.test(database) || !token)throw Error('D1 configuration required');
    this.endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
    this.token=token;this.fetcher=fetcher;
  }
  prepare(sql) {
    return {bind:(...params)=>{
      const query=async()=>{
        let result;
        try {
          const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
          if(!response.ok)throw Error();
          result=await response.json();
        }catch{throw Error('Rescue database unavailable');}
        if(!result?.success || !Array.isArray(result.result) || result.result.length!==1 || !result.result[0].success)throw Error('Rescue database unavailable');
        return result.result[0];
      };
      return {run:query,first:async()=>{const r=await query();return r.results?.[0]??null;}};
    }};
  }
}
