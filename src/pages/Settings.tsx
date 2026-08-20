import { Navigate, useParams } from 'react-router'
import SettingsLayout from '@/components/settings/SettingsLayout'
import {
  AccountPanel, AppearancePanel, ConnectionsPanel, ExecutionPanel,
  KeysPanel, ModelsPanel, ToolsPanel,
} from '@/components/settings/panels'
import { useProviderConfig } from '@/components/settings/use-settings-state'
import { DEFAULT_SECTION, isSettingsSection, sectionPath } from '@/lib/settings-catalog'

/**
 * One route per section, so a settings row can be linked to. The old surface
 * was a sheet inside a sheet: nothing could deep-link to it, search could not
 * reach it, and the back button dismissed the whole app.
 */
export default function Settings() {
  const { section } = useParams<{ section?: string }>()
  const [config, update] = useProviderConfig()

  if (!isSettingsSection(section)) {
    return <Navigate to={sectionPath(DEFAULT_SECTION)} replace />
  }

  return (
    <SettingsLayout section={section}>
      {section === 'general' ? <AccountPanel /> : null}
      {section === 'models' ? <ModelsPanel config={config} update={update} /> : null}
      {section === 'keys' ? <KeysPanel config={config} update={update} /> : null}
      {section === 'tools' ? <ToolsPanel /> : null}
      {section === 'execution' ? <ExecutionPanel config={config} update={update} /> : null}
      {section === 'appearance' ? <AppearancePanel /> : null}
      {section === 'connections' ? <ConnectionsPanel /> : null}
    </SettingsLayout>
  )
}
