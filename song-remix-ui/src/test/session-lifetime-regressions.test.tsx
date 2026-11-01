import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { api } from '@/lib/api';
import { captureAuthSession, clearToken, getToken, setToken } from '@/lib/auth';
import { beginAuthIntent } from '@/lib/auth-cookie-writers';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useLogin, useRegister } from '@/hooks/useAuth';
import { ResultPlayer } from '@/components/studio/ResultPlayer';
import { SongSetup } from '@/components/studio/SongSetup';
import { GeneratePanel } from '@/components/studio/GeneratePanel';
import { TaskMonitorProvider } from '@/components/layout/TaskMonitorProvider';
import { renderApplication, renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (value:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b}); return {resolve,reject,promise}; }
function mediaStubs() {
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
}
afterEach(()=>{cleanup();clearToken();useAudioPlayer.getState().stop();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('fresh independent Fix1 final-publication and lifetime probes',()=>{
  it('does not navigate B when identity changes after JSON validation but before SongSetup continuation',async()=>{
    setToken('A'); const body=deferred<unknown>(); const started=deferred<void>(); const created=vi.fn();
    const response=new Response(null,{status:201}); response.json=()=>{started.resolve();return body.promise};
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response);
    const view=render(<SongSetup onSongCreated={created}/>);
    fireEvent.change(screen.getByLabelText('Song title'),{target:{value:'A title'}});
    fireEvent.click(screen.getByRole('button',{name:'Continue to style selection'}));
    await started.promise;
    await act(async()=>{
      body.resolve({id:'A-song'});
      queueMicrotask(()=>{view.unmount();setToken('B')});
      for(let n=0;n<12;n++) await Promise.resolve();
    });
    expect(getToken()).toBe('B'); expect(created).not.toHaveBeenCalled();
  });

  it('clears B global player on shell teardown after identity replacement within the same protected shell',async()=>{
    mediaStubs();vi.stubGlobal('scrollTo',vi.fn());
    server.use(http.get('/api/tasks',()=>HttpResponse.json([])),http.get('/api/auth/me',()=>HttpResponse.json({id:'A',username:'A',email:'a@example.test'})),http.get('/api/engines/status',()=>HttpResponse.json({health:[]})));
    const view=await renderApplication(['/settings'],'A'); await screen.findByRole('heading',{name:'Settings'});
    await act(async()=>{setToken('B');await Promise.resolve()});
    await act(async()=>useAudioPlayer.getState().play('B-task','B title','/api/tasks/B-task/audio'));
    const audio=document.querySelector('audio')!;expect(audio.getAttribute('src')).toBe('/api/tasks/B-task/audio');
    view.unmount();expect(audio.getAttribute('src')).toBeNull();
    expect(useAudioPlayer.getState()).toMatchObject({trackId:null,trackTitle:null,audioUrl:null,isPlaying:false,progress:0,duration:0,ownerEpoch:null});
  });

  it('preserves the new inline source when a mounted ResultPlayer receives another task',()=>{
    setToken('A');mediaStubs();const view=render(<ResultPlayer taskId='task-one'/>);
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/tasks/task-one/audio');
    view.rerender(<ResultPlayer taskId='task-two'/>);
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/tasks/task-two/audio');
    fireEvent.click(screen.getByRole('button',{name:'Play'}));
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/tasks/task-two/audio');
  });

  it('preserves inline playback source in the actual GeneratePanel when completed task changes',()=>{
    setToken('A');mediaStubs();const client=new QueryClient();
    const task={id:'task-one',song_id:'song-one',status:'completed' as const,engine:'acestep',created_at:'2026-01-01T00:00:00Z'};
    const tree=(id:string)=><QueryClientProvider client={client}><TaskMonitorProvider isEnabled={false}><GeneratePanel songId='song-one' request={null} disabled={true} initialTask={{...task,id} as never}/></TaskMonitorProvider></QueryClientProvider>;
    const view=render(tree('task-one'));expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/tasks/task-one/audio');
    view.rerender(tree('task-two'));
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/tasks/task-two/audio');
  });

  it('does not send an A-cookie renewal queued during the latest B login before hook identity publication',async()=>{
    setToken('A');const loginResponse=deferred<Response>();const started=deferred<void>();const settled=deferred<void>();const renewals:string[]=[];
    const client=new QueryClient({mutationCache:new MutationCache({onSettled:()=>settled.resolve()}),defaultOptions:{mutations:{retry:false}}});
    function Form(){const login=useLogin();return <button onClick={()=>login.mutate({email:'b@example.test',password:'fake'})}>Submit B</button>}
    vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{if(String(input).endsWith('/auth/login')){started.resolve();return loginResponse.promise}renewals.push((init?.headers as Record<string,string>).Authorization);return Promise.resolve(Response.json({id:'A'}))});
    await renderWithProviders(<QueryClientProvider client={client}><Form/></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Submit B'}));await started.promise;
    const me=api.auth.me().catch(e=>e.name);
    await act(async()=>{loginResponse.resolve(Response.json({access_token:'B'}));await settled.promise;await me});
    expect(getToken()).toBe('B');expect(renewals).not.toContain('Bearer A');
  });

  it.each(['login','register'] as const)('fences actual %s hook success after helper resolved and logout intent superseded it',async(kind)=>{
    const reached=deferred<void>();const release=deferred<void>();const completed=deferred<void>();
    const client=new QueryClient({mutationCache:new MutationCache({onSuccess:async()=>{reached.resolve();await release.promise},onSettled:()=>{completed.resolve()}}),defaultOptions:{mutations:{retry:false}}});
    function Form(){const login=useLogin();const register=useRegister();return <button onClick={()=>kind==='login'?login.mutate({email:'a@example.test',password:'fake'}):register.mutate({email:'a@example.test',username:'A',password:'fake'})}>Submit</button>}
    server.use(http.post('/api/auth/'+kind,()=>HttpResponse.json({access_token:'A'})));
    await renderWithProviders(<QueryClientProvider client={client}><Form/></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Submit'}));await reached.promise;
    beginAuthIntent();clearToken();client.setQueryData(['user'],{id:'B-marker'});
    await act(async()=>{release.resolve();await completed.promise});
    expect(getToken()).toBeNull();expect(client.getQueryData(['user'])).toEqual({id:'B-marker'});
  });

  it('reserves captured A logout even if it is superseded and local identity is cleared before admission',async()=>{
    setToken('A');const held=deferred<Response>();const started=deferred<void>();const admitted:string[]=[];let logoutAuth:string|undefined;
    vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{const url=String(input);admitted.push(url);if(url.endsWith('/auth/me')){started.resolve();return held.promise}if(url.endsWith('/auth/logout')){logoutAuth=(init?.headers as Record<string,string>).Authorization;return Promise.resolve(new Response(null,{status:204}))}return Promise.resolve(Response.json({access_token:'B'}))});
    const me=api.auth.me().catch(e=>e.name);await started.promise;const session=captureAuthSession();const intent=beginAuthIntent();
    const logout=api.auth.logout(session,intent).catch(e=>e.name);clearToken();const login=api.auth.login({email:'b@example.test',password:'fake'});
    await Promise.resolve();expect(admitted).toEqual(['/api/auth/me']);held.reject(new DOMException('aborted','AbortError'));
    await Promise.all([me,logout,login]);expect(logoutAuth).toBe('Bearer A');expect(admitted).toEqual(['/api/auth/me','/api/auth/logout','/api/auth/login']);
  });

  it('forwards caller cancellation and waits for the admitted fetch to settle before the next me writer',async()=>{
    setToken('A');const first=deferred<Response>();const started=deferred<void>();const caller=new AbortController();let firstSignal:AbortSignal|undefined;let calls=0;
    vi.spyOn(globalThis,'fetch').mockImplementation((_input,init)=>{calls++;if(calls===1){firstSignal=init?.signal as AbortSignal;started.resolve();return first.promise}return Promise.resolve(Response.json({id:'A'}))});
    const pending=api.auth.me(caller.signal).catch(e=>e.name);await started.promise;caller.abort();const next=api.auth.me();
    await Promise.resolve();expect(firstSignal?.aborted).toBe(true);expect(calls).toBe(1);first.reject(new DOMException('aborted','AbortError'));
    await Promise.all([pending,next]);expect(calls).toBe(2);
  });
});
