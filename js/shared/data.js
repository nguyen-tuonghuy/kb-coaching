/* Read services with explicit dependencies. No DOM, cache or startup side effects. */
(() => {
  window.KinballCoach.createDataServices=({db,getUser})=>({
    async profiles(userIds){
      const ids=[...new Set((userIds||[]).filter(Boolean))];
      if(!ids.length)return {};
      const {data,error}=await db.from('user_profiles').select('user_id,first_name').in('user_id',ids);
      if(error)throw error;
      const map={};
      (data||[]).forEach(p=>map[p.user_id]=p.first_name);
      return map;
    },
    async myProfile(){
      const user=getUser();
      if(!user)return null;
      const {data,error}=await db.from('user_profiles').select('first_name').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      return data||null;
    },
    async myGroups(){
      const {data,error}=await db.from('coaching_group_coaches')
        .select('role,group:coaching_groups!coaching_group_coaches_group_id_fkey(id,name,club,invite_code)')
        .eq('user_id',getUser().id)
        .order('joined_at',{ascending:true});
      if(error)throw error;
      return (data||[]).filter(x=>x.group).map(x=>({...x.group,role:x.role}));
    },
    async groupPlayers(groupId){
      if(!groupId)return [];
      const {data,error}=await db.from('coaching_group_players')
        .select('player_id,active,preferred_role,stats_access,player:players!coaching_group_players_player_id_fkey(id,display_name)')
        .eq('group_id',groupId).eq('active',true);
      if(error)throw error;
      return (data||[]).filter(x=>x.player).map(x=>({...x.player,preferred_role:x.preferred_role||'AP',stats_access:x.stats_access||'personal'})).sort((a,b)=>a.display_name.localeCompare(b.display_name,'fr'));
    },
    async playerAccess(){
      const {data,error}=await db.rpc('get_my_player_access');
      if(error)throw error;
      return data||[];
    },
    async matchTypes(){
      const {data,error}=await db.from('match_types')
        .select('id,name,slug,active,is_native,created_by,created_at,updated_by,updated_at')
        .order('is_native',{ascending:false}).order('name');
      if(error)throw error;
      return data||[];
    },
    async exerciseCategories(){
      const {data,error}=await db.from('exercise_categories')
        .select('id,name,slug,active,is_native,is_dual_focus,created_by,created_at,updated_by,updated_at')
        .order('is_native',{ascending:false}).order('name');
      if(error)throw error;
      return data||[];
    },
    async trainingSessions(groupId){
      const {data,error}=await db.from('training_sessions')
        .select('id,trained_on,label,theme')
        .eq('group_id',groupId).order('trained_on',{ascending:true});
      if(error)throw error;
      return data||[];
    },
    async trainingResults(sessionIds){
      if(!sessionIds.length)return {attendance:[],sessionExercises:[],results:[]};
      const responses=await Promise.all([
        db.from('training_attendance').select('session_id,player_id,present').in('session_id',sessionIds),
        db.from('training_session_exercises')
          .select('session_id,exercise_id,focus,position,exercise:exercises!training_session_exercises_exercise_id_fkey(id,name,category,category_id,copied_from_exercise_id,measurement_type)')
          .in('session_id',sessionIds),
        db.from('training_results').select('id,session_id,exercise_id,player_id,successes,attempts,numeric_value,note,created_at').in('session_id',sessionIds)
      ]);
      for(const response of responses)if(response.error)throw response.error;
      return {attendance:responses[0].data||[],sessionExercises:responses[1].data||[],results:responses[2].data||[]};
    },
    async groupSelections(groupId,{includeArchived=false}={}){
      if(!groupId)return [];
      let query=db.from('coaching_group_selections')
        .select('id,group_id,name,selection_type,starts_on,ends_on,archived,created_at,updated_at')
        .eq('group_id',groupId)
        .order('created_at',{ascending:true});
      if(!includeArchived)query=query.eq('archived',false);
      const {data:selections,error}=await query;
      if(error)throw error;
      const ids=(selections||[]).map(s=>s.id);
      let members=[];
      if(ids.length){
        const {data,error}=await db.from('coaching_group_selection_players')
          .select('selection_id,player_id').in('selection_id',ids);
        if(error)throw error;
        members=data||[];
      }
      const bySelection=new Map();
      members.forEach(row=>{if(!bySelection.has(row.selection_id))bySelection.set(row.selection_id,[]);bySelection.get(row.selection_id).push(row.player_id)});
      return (selections||[]).map(s=>({...s,player_ids:bySelection.get(s.id)||[]}));
    }
  });
})();
