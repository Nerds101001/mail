import { useState, useEffect } from 'react'
import { PageHeader, Card, Btn, Input, Select, Modal, Empty, toast } from '../components/ui'
import { Plus, Trash2, Pencil, Users, Shield } from 'lucide-react'

export default function UsersPage() {
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]     = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]     = useState({ username:'', password:'', name:'', role:'user', active:true })
  const token = localStorage.getItem('crm_token')
  const role  = localStorage.getItem('crm_role')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/auth?type=users&token=${token}`)
      if (res.ok) setUsers(await res.json())
    } catch(e) { toast('Could not load users', 'error') }
    setLoading(false)
  }

  async function saveUser() {
    if (!form.username || (!editing && !form.password)) { toast('Username and password required', 'error'); return }
    try {
      const url = editing ? `/api/auth?type=users&id=${editing}&token=${token}` : `/api/auth?type=users&token=${token}`
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) })
      const data = await res.json()
      if (data.ok || data.id) { toast(editing ? 'User updated' : 'User created', 'success'); setOpen(false); load() }
      else throw new Error(data.error)
    } catch(e) { toast('Failed: '+e.message, 'error') }
  }

  async function deleteUser(id, name) {
    if (!confirm(`Delete user "${name}"? Their data will remain but they cannot log in.`)) return
    try {
      const res = await fetch(`/api/auth?type=users&id=${id}&token=${token}`, { method:'DELETE' })
      if ((await res.json()).ok) { toast('User deleted', 'info'); load() }
    } catch(e) { toast('Failed', 'error') }
  }

  function openEdit(u) {
    setEditing(u.id)
    setForm({ username:u.username, password:'', name:u.name, role:u.role, active:u.active })
    setOpen(true)
  }

  function openAdd() {
    setEditing(null)
    setForm({ username:'', password:'', name:'', role:'user', active:true })
    setOpen(true)
  }

  if (role !== 'admin') {
    return (
      <div className="card p-16 text-center">
        <Shield size={32} className="text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-600">Admin access required</p>
        <p className="text-xs text-slate-400 mt-1">Only admins can manage users</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="User Management" subtitle="Admin creates team accounts — each user sees only their own data">
        <Btn variant="primary" onClick={openAdd}><Plus size={14} /> Add User</Btn>
      </PageHeader>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Name','Username','Role','Status','Actions'].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5}><Empty icon={Users} title="No users yet" sub="Add team members to give them access" /></td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="table-row">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700">
                      {(u.name||u.username)[0].toUpperCase()}
                    </div>
                    <span className="font-semibold text-slate-900">{u.name || u.username}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`badge text-[11px] ${u.role==='admin'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge text-[11px] ${u.active?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'}`}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" onClick={()=>openEdit(u)}><Pencil size={13}/></button>
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" onClick={()=>deleteUser(u.id,u.name||u.username)}><Trash2 size={13}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={()=>setOpen(false)} title={editing ? 'Edit User' : 'Add Team Member'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Full Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="John Doe" />
            <Input label="Username *" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="john.doe" />
          </div>
          <Input label={editing ? "New Password (leave blank to keep)" : "Password *"} type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
            <Select label="Status" value={form.active} onChange={e=>setForm({...form,active:e.target.value==='true'})}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
            Each user sees only their own leads, clients, deals and campaigns. Sender profiles and AI key are shared.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={()=>setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={saveUser}>{editing ? 'Update' : 'Create User'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
