import { ErrorState } from '@/components/ErrorState';
import { EditProfileDialog } from '@/components/account/EditProfileDialog';
import { EditVehicleDialog } from '@/components/account/EditVehicleDialog';
import { FieldRow } from '@/components/account/FieldRow';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { getAccount, getVehicle } from '@/lib/api';
import { formatMileage, maskVinTail, vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export function AccountPage() {
  const { data: account, error: accountError } = useApi(getAccount);
  const { data: vehicle, error: vehicleError } = useApi(getVehicle);
  const toast = useToast();

  return (
    <div>
      <PageHeader title="Account" />

      {accountError && <ErrorState message={accountError.message} className="mb-4" />}

      <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
        {/* Profile */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            {account ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{initials(account.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-lg font-semibold leading-tight">{account.name}</div>
                    <div className="text-sm text-muted-foreground">Member since {account.memberSince}</div>
                  </div>
                </div>
                <div>
                  <FieldRow label="Email" value={account.email} />
                  <FieldRow label="Phone" value={account.phone} />
                </div>
                <EditProfileDialog account={account} />
              </>
            ) : (
              <CardSkeleton />
            )}
          </CardContent>
        </Card>

        {/* Vehicle */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            {vehicleError ? (
              <ErrorState message={vehicleError.message} />
            ) : vehicle ? (
              <>
                <h2 className="text-lg font-semibold tracking-tight">Your vehicle</h2>
                <div>
                  <FieldRow label="Vehicle" value={vehicleName(vehicle)} />
                  <FieldRow label="VIN" value={maskVinTail(vehicle.vin)} />
                  <FieldRow label="Mileage" value={formatMileage(vehicle.mileage)} />
                </div>
                <EditVehicleDialog vehicle={vehicle} />
              </>
            ) : (
              <CardSkeleton />
            )}
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card className="md:col-span-2">
          <CardContent className="space-y-4 p-4 sm:p-6">
            {account ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight">Subscription</h2>
                  <Badge variant="outline" className="shrink-0">
                    {account.plan === 'paid' ? 'Paid plan' : 'Free plan'}
                  </Badge>
                </div>
                <div>
                  {account.features.map((feature) => (
                    <FieldRow
                      key={feature.name}
                      label={feature.name}
                      value={
                        feature.status === 'Active' ? (
                          <span className="font-semibold">{feature.status}</span>
                        ) : (
                          feature.status
                        )
                      }
                    />
                  ))}
                </div>
                <Button className="w-full" onClick={() => toast('Subscription management is not wired up yet.')}>
                  Manage subscription
                </Button>
              </>
            ) : (
              <CardSkeleton />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function CardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-40" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
