import { BrowserRouter, Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { QuoteTemplatesPage } from './features/quotes/QuoteTemplatesPage'
import { Auth } from './features/auth/Auth'
import { AccountsPage } from './features/auth/AccountsPage'
import { CustomersPage } from './features/customers/CustomersPage'
import { SkuPage } from './features/catalog/SkuPage'
import { DictionariesPage } from './features/dictionaries/DictionariesPage'
import { VehicleLibraryPage } from './features/vehicles/VehicleLibraryPage'

export default function App() {
  return (
    <BrowserRouter>
      <Auth>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="quotes/templates" element={<QuoteTemplatesPage />} />
            <Route path="skus" element={<SkuPage />} />
            <Route path="vehicles" element={<VehicleLibraryPage />} />
            <Route path="vehicles/:familyId/:generationCode" element={<VehicleLibraryPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="settings/accounts" element={<AccountsPage />} />
            <Route
              path="settings/dictionaries"
              element={<DictionariesPage scope="configuration" />}
            />
            <Route path="sku-foundation" element={<DictionariesPage scope="sku_foundation" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Auth>
    </BrowserRouter>
  )
}
