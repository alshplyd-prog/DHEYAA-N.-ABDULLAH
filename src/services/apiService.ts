/**
 * Dedicated API Service Layer
 * Connects the React client to the Node.js backend server via standard REST endpoints.
 */

import { getApiBaseUrl, HOSTINGER_DEFAULT_SERVER, isNativeOrApkEnvironment, fetchWithFallback } from '../lib/apiConfig';

/**
 * Production VPS backend URL for mobile APK and external environments
 */
export const CLOUD_API_URL = `${HOSTINGER_DEFAULT_SERVER}/api`;

/**
 * Dynamic API Base URL resolver:
 * - Directs all mobile / APK requests directly to HOSTINGER_DEFAULT_SERVER/api
 * - In web browser, uses relative `/api` or active origin
 */
export function getActiveApiUrl(): string {
  if (typeof window !== 'undefined') {
    if (!isNativeOrApkEnvironment()) {
      const custom = getApiBaseUrl();
      if (custom) return `${custom.replace(/\/+$/, '')}/api`;
      return '/api';
    }
    const base = getApiBaseUrl();
    if (base) {
      return `${base.replace(/\/+$/, '')}/api`;
    }
  }
  return CLOUD_API_URL;
}

export const API_BASE_URL = getActiveApiUrl();

// Helper function for all HTTP requests unified via fetchWithFallback (handles APK native HTTP & Web fallback)
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const apiPath = cleanEndpoint.startsWith('api/') ? `/${cleanEndpoint}` : `/api/${cleanEndpoint}`;

  try {
    const response = await fetchWithFallback(
      apiPath,
      {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(options.headers || {}),
        },
      },
      12000
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
        throw new Error('استجابة السيرفر غير صالحة (يبدو أن الخادم أعمل إعادة توجيه أو يعرض صفحة خطأ HTML بدلاً من بيانات JSON)');
      }
      throw new Error(`خطأ في قراءة رد السيرفر`);
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || `خطأ في الاتصال بالسيرفر (${response.status})`);
    }

    return data;
  } catch (err: any) {
    if (err.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('timeout')) {
      throw new Error('انتهت مهلة الاتصال بالسيرفر. يرجى التحقق من اتصال الإنترنت.');
    }
    throw err;
  }
}

// ==========================================
// 1. قسم الزبائن والمبيعات (Customers & Sales)
// ==========================================
export const SalesService = {
  // جلب كافة العقود والمبيعات
  async getAllSales(): Promise<any[]> {
    return apiRequest<any[]>('/contracts');
  },

  // إضافة بيع / عقد جديد
  async createSale(saleData: {
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    itemName: string;
    totalPrice: number;
    advancePayment: number;
    dailyInstallment: number;
    listId?: string;
    listName?: string;
    notes?: string;
    repId?: string;
    repName?: string;
    startDate?: string;
  }): Promise<any> {
    return apiRequest<any>('/contracts', {
      method: 'POST',
      body: JSON.stringify(saleData),
    });
  },

  // تعديل عقد بيع
  async updateSale(id: string, updatedData: any): Promise<any> {
    return apiRequest<any>(`/contracts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedData),
    });
  },

  // حذف عقد
  async deleteSale(id: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(`/contracts/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==========================================
// 2. قسم المدفوعات والتحصيلات (Payments)
// ==========================================
export const PaymentsService = {
  // جلب سجل المدفوعات
  async getPayments(): Promise<any[]> {
    return apiRequest<any[]>('/payments');
  },

  // تسديد دفعة جديدة
  async addPayment(paymentData: {
    contractId: string;
    amount: number;
    receiptNumber?: string;
    repName?: string;
    repId?: string;
    notes?: string;
    fundId?: string;
    paymentMethod?: string;
    createdAt?: string;
  }): Promise<any> {
    return apiRequest<any>('/payments', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
  },

  // تعديل دفعة
  async updatePayment(paymentId: string, updatedData: any): Promise<any> {
    return apiRequest<any>(`/payments/${paymentId}`, {
      method: 'PUT',
      body: JSON.stringify(updatedData),
    });
  },

  // حذف دفعة
  async deletePayment(paymentId: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(`/payments/${paymentId}`, {
      method: 'DELETE',
    });
  },
};

// ==========================================
// 3. قسم الأرصدة والصناديق المالية (Funds & Balances)
// ==========================================
export const FundsService = {
  // جلب بيانات الصناديق والأرصدة
  async getFunds(): Promise<any[]> {
    return apiRequest<any[]>('/funds');
  },

  // جلب الحركات المالية
  async getFundTransactions(): Promise<any[]> {
    return apiRequest<any[]>('/fund-transactions');
  },

  // إنشاء حركة مالية (إيداع، سحب، أو تحويل بين الصناديق)
  async createTransaction(txData: {
    fundId: string;
    type: 'deposit' | 'withdraw' | 'transfer';
    amount: number;
    targetFundId?: string;
    notes?: string;
    repId?: string;
    repName?: string;
    createdAt?: string;
  }): Promise<any> {
    return apiRequest<any>('/fund-transactions', {
      method: 'POST',
      body: JSON.stringify(txData),
    });
  },

  // إنشاء صندوق مالي جديد
  async createFund(fundData: { name: string; balance?: number; type?: string; description?: string }): Promise<any> {
    return apiRequest<any>('/funds', {
      method: 'POST',
      body: JSON.stringify(fundData),
    });
  },
};

// ==========================================
// 4. قسم الموظفين والمندوبين (Employees & Reps)
// ==========================================
export const EmployeesService = {
  // جلب الموظفين
  async getEmployees(): Promise<any[]> {
    return apiRequest<any[]>('/employees');
  },

  // جلب المندوبين
  async getReps(): Promise<any[]> {
    return apiRequest<any[]>('/reps');
  },
};

// ==========================================
// 5. المزامنة والتحقق من الإصدار (Sync Version)
// ==========================================
export const SyncService = {
  async getSyncVersion(): Promise<{ success: boolean; syncVersion: number; timestamp: number }> {
    return apiRequest<{ success: boolean; syncVersion: number; timestamp: number }>('/sync/version');
  },
};
